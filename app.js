'use strict';

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const pg = require('pg');
const request = require('request');
const app = express();
const uuid = require('uuid');
const user = require('./user');
const userdata = require('./userdata');

// const storeUserDOB = [];


// var db_url = "postgres://rtkybbbvnorvjb:ab96d298a9e0f3f3d1e32f387853252f56bf5a68ce93e929c79c0cf78b5370a4@ec2-54-227-237-223.compute-1.amazonaws.com:5432/dfk4kqljdci4bd";

// const client = new pg.Client(db_url);
// client.connect();


pg.defaults.ssl = true;


// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}


app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "en",
	requestSource: "fb"
});
const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
	 res.send('Hello world, I am a chat bot after deployment');
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});

function setSessionAndUser(senderID) {
	if (!sessionIds.has(senderID)) {
		sessionIds.set(senderID, uuid.v1());
	}
 
	if (!usersMap.has(senderID)) {
		user(function(user) {
			usersMap.set(senderID, user);
		}, senderID);
	}
}



function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;

	setSessionAndUser(senderID);
	//console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	//console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	} else if (messageAttachments) {
		handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleMessageAttachments(messageAttachments, senderID){
	//for now just reply
	sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
	sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
	// Just logging message echoes to console
	console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {

		case "main-izo-flow" :
			if (isDefined(contexts[0]) &&
				(contexts[0].name == 'zero-message' || contexts[1].name == '1-message-izo_dialog_context' || contexts[1].name == 'zero-message')
				&& contexts[0].parameters) {
				let quick_birth = (isDefined(contexts[0].parameters['birth-user'])
				&& contexts[0].parameters['birth-user']!= '') ? contexts[0].parameters['birth-user'] : '';
				let quick_name = (isDefined(contexts[0].parameters['name-user'])
				&& contexts[0].parameters['name-user']!= '') ? contexts[0].parameters['name-user'] : '';
				let quick_gender = (isDefined(contexts[0].parameters['gen-user'])
				&& contexts[0].parameters['gen-user']!= '') ? contexts[0].parameters['gen-user'] : '';

				console.log("1st if success");

				if(quick_name == '' && quick_birth != '' && quick_gender == '') {
		   				let replies = [
						{
							"content_type":"text",
							"title":"Male",
							"payload":"male"
						},
						{
							"content_type":"text",
							"title":"Female",
							"payload":"female"
						}
					];
					sendQuickReply(sender, responseText, replies);
				} else if(quick_birth != '' && quick_name != '' && quick_gender != '') {

					var userGen = contexts[0].parameters["gen-user"];

					var userNa = contexts[0].parameters["name-user"];

		   			var date = contexts[0].parameters["birth-user"];

		   			//this is destiny number calculation
				 	function MainDate(){
							 function mainDob(){
								 
								 var splitDate = date.replace(/[^0-9]/g, '');
								 var total = 0;
								 for (var i = 0; i < splitDate.length; i++) {
									 		for (var j = 0; j < splitDate[i].length; j++){
												total += parseInt(splitDate[i].charAt(j));
											}
								 }
								 total = total.toString();

								 while (total.length > 1) {
									 var tempTotal = 0;
									 for (var i = 0; i < total.length; i++) {
										 tempTotal += parseInt(total.charAt(i));
									 }
									 total = tempTotal.toString();
									 return total;
								 }
							 }
				 return mainDob();
			}
					// this is psychic number calculation
					function MainPynum(){
									 function mainpynum(){
										 
										 var splitDate = date.replace(/[^0-9]/g, '');
										 var lastDate = splitDate.slice(6, 8);
        
								         var value = lastDate,
								         sum = 0;
								        
								         while (value) {
								            sum += value % 10;
								            value = Math.floor(value / 10);
								         }
								        
								        return (sum);
									 }
						 return mainpynum();
					}
				 var destN =  MainDate();
				 var psyN =  MainPynum();

				 var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1Af7x2gWZV3uF9OFaHe6Jvoz5dZ8iUCFGb-ho9D2SE8M&sheet=contentmainflow&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						//let someData = contexts[0].parameters["birth-user"];
   						let fullData = `${dataIzo["contentmainflow"][psyN - 1]["Psychicnumber"]}`;
						let desData = `${dataIzo["contentmainflow"][destN - 1]["Destinynumber"]}`;
						let charData = `${dataIzo["contentmainflow"][psyN - 1]["Characteristics"]}`;
						let negData = `${dataIzo["contentmainflow"][psyN - 1]["NegativeTraits"]}`;
						let postData = `${dataIzo["contentmainflow"][psyN - 1]["PositiveTraits"]}`;
						let luckyNumData = `${dataIzo["contentmainflow"][psyN - 1]["LuckyNumber"]}`;
						let luckyColor = `${dataIzo["contentmainflow"][psyN - 1]["LuckyColour"]}`;
						let luckyDayData = `${dataIzo["contentmainflow"][psyN - 1]["Lucky_Day"]}`;
						let luckyGem = `${dataIzo["contentmainflow"][psyN - 1]["LuckyGemstone"]}`;
						let unluckyColor = `${dataIzo["contentmainflow"][psyN - 1]["Unlucky_Colour"]}`;
						let unluckyDay = `${dataIzo["contentmainflow"][psyN - 1]["Unlucky_Day"]}`;
						let unluckyNum = `${dataIzo["contentmainflow"][psyN - 1]["Unlucky_Number"]}`;

						sendTextMessage(sender, "Your Psychic Number is :"+" "+fullData);
						setTimeout(function() {
					    sendTextMessage(sender, "Your Destiny Number is :"+" "+desData);
						}, 5000)
						//sendTextMessage(sender, "Your Destiny Number is :"+" "+desData);
					 	
						// Store Info into DB POSTgres
						//storeUserDOB.push(date);
						userdata.storeUserData(sender, date, userGen, userNa, psyN, fullData, destN, desData, charData, postData, negData, luckyColor, luckyNumData, luckyDayData, luckyGem, unluckyColor, unluckyDay, unluckyNum);
						sendTypingOn(sender);
						// const query = client.query("INSERT INTO public.user_izo_data (fb_id, dob, gender, user_name, psy_no, psy_data, dest_no, dest_data, characteristics, post_traits, neg_traits, lucky_color, lucky_number, lucky_day, lucky_gemstone, unlucky_color, unlucky_day, unlucky_num) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning *", [sender, date, userGen, userNa, psyN, fullData, destN, desData, charData, postData, negData, luckyColor, luckyDayData, luckyGem, unluckyColor, unluckyDay, unluckyNum]);
						// client.end();
						if (storeUserDOB[0] != '') {
							storeUserDOB.splice(storeUserDOB[0], date);
							setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Gemstone",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 10000)

						} else {
						storeUserDOB.push(date);
						sendTextMessage(sender, storeUserDOB[0]);


						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Gemstone",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 10000)
					}
					}else {
						console.error(response.error);
					}
				});
			} else {
				console.log("2nd error");
				sendTextMessage(sender, responseText);
			}
		}
		break;
	
	case "final-message-izo" :
				var date = storeUserDOB[0];

				function MainPynumChar(){
						 function mainpynum(){
							 
							 var splitDate = date.replace(/[^0-9]/g, '');
							 var lastDate = splitDate.slice(6, 8);

						     var value = lastDate,
						     sum = 0;
						    
						     while (value) {
						        sum += value % 10;
						        value = Math.floor(value / 10);
						     }
						    
						    return (sum);
						 }
					return mainpynum();
					}
				var navDa = MainPynumChar();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["Characteristics"]}`;

						sendTextMessage(sender, "Your Characteristics is :"+" "+ fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			break;
		case "negative-message-izo" :
				var date = storeUserDOB[0];

				function MainPynumNeg(){
						 function mainpynum(){
							 
							 var splitDate = date.replace(/[^0-9]/g, '');
							 var lastDate = splitDate.slice(6, 8);

						     var value = lastDate,
						     sum = 0;
						    
						     while (value) {
						        sum += value % 10;
						        value = Math.floor(value / 10);
						     }
						    
						    return (sum);
						 }
					 return mainpynum();
					}
				var navDa = MainPynumNeg();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["NegativeTraits"]}`;

						sendTextMessage(sender, "Your Negative Traits is :"+" "+ fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			break;
		case "positive-message-izo" :

				var date = storeUserDOB[0];

				function MainPynumPost(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumPost();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["PositiveTraits"]}`;

						sendTextMessage(sender, "Your Positive Traits is" + " "+ fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			break;
		case "luckyday-message-izo" :
				var date = storeUserDOB[0];

				function MainPynumLD(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumLD();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["Lucky_Day"]}`;

						sendTextMessage(sender, "Your Lucky Day is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			break;
		case "luckycolor-message-izo" :
			

				var date = storeUserDOB[0];

				function MainPynumLC(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumLC();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["LuckyColour"]}`;

						sendTextMessage(sender, "Your Lucky Colour is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			
			break;
		case "luckynum-message-izo" :
			

				var date = storeUserDOB[0];

				function MainPynumLN(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumLN();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["LuckyNumber"]}`;

						sendTextMessage(sender, "Your Lucky Number is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			
			break;
		case "luckygem-message-izo" :
			

				var date = storeUserDOB[0];

				function MainPynumLG(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumLG();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["LuckyGemstone"]}`;

						sendTextMessage(sender, "Your Lucky Gemstone is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			
			break;
		case "unluckyday-message-izo" :
			

				var date = storeUserDOB[0];

				function MainPynumUD(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumUD();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["Unlucky_Day"]}`;

						sendTextMessage(sender, "Your Unlucky Day is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			
			break;
		case "unluckynum-message-izo" :
			

				var date = storeUserDOB[0];

				function MainPynumUN(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumUN();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["Unlucky_Number"]}`;

						sendTextMessage(sender, "Your Unlucky Number is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Colour",
									"payload":"UNLUCKY_COLOUR"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			
			break;
		case "unluckycol-message-izo" :
			

				var date = storeUserDOB[0];

				function MainPynumUC(){
					 function mainpynum(){
						 
						 var splitDate = date.replace(/[^0-9]/g, '');
						 var lastDate = splitDate.slice(6, 8);

					     var value = lastDate,
					     sum = 0;
					    
					     while (value) {
					        sum += value % 10;
					        value = Math.floor(value / 10);
					     }
					    
					    return (sum);
					 }
					 return mainpynum();
					}
				var navDa = MainPynumUC();

				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1tkWV29_lM0A2ct6HTcwMAvfvcWMDnGfd3fKSPJgyTWE&sheet=PsychicNumber&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let someData = parameters["user-number"];
						let fullData = `${dataIzo["PsychicNumber"][navDa - 1]["Unlucky_Colour"]}`;

						sendTextMessage(sender, "Your Unlucky Colour is"+ " " + fullData);
						sendTypingOn(sender);

						//ask what user wants to do next
						setTimeout(function() {
							let buttons = [
								{
									"content_type":"text",
									"title":"Characteristics",
									"payload":"CHARACTERISTICS"
								},
								{
									"content_type":"text",
									"title":"Positive Traits",
									"payload":"POSITIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Negative Traits",
									"payload":"NEGATIVE_TRAITS"
								},
								{
									"content_type":"text",
									"title":"Lucky Colour",
									"payload":"LUCKY_COLOR"
								},
								{
									"content_type":"text",
									"title":"Lucky Day",
									"payload":"LUCKY_DAY"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_GEMSTONE"
								},
								{
									"content_type":"text",
									"title":"Lucky Number",
									"payload":"LUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Number",
									"payload":"UNLUCKY_NUMBER"
								},
								{
									"content_type":"text",
									"title":"Unlucky Day",
									"payload":"UNLUCKY_DAY"
								}
							];

							sendQuickReply(sender, "What would you like to do next?", buttons);
						}, 5000)


					}else {
						console.error(response.error);
					}
				});
			
			break;
		case "compatible-izo":
			if (parameters.hasOwnProperty("compt-dob") && parameters["compt-dob"]!='') {
		   			var date = parameters["compt-dob"];

					// this is psychic number cal
					function MainPynum(){
						 function mainpynum(){
							 
							 var splitDate = date.replace(/[^0-9]/g, '');
							 var lastDate = splitDate.slice(6, 8);

					         var value = lastDate,
					         sum = 0;
					        
					         while (value) {
					            sum += value % 10;
					            value = Math.floor(value / 10);
					         }
					        
					        return (sum);
						 }
						 return mainpynum();
					}
				 var kumar =  MainPynum();

				 var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1ucB1cvwOVH0IqiJI3bOKTBGkKO27TFQeRVOHsFLq3AQ&sheet=relationship&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let dataIzo = JSON.parse(body);
						let comp = `${dataIzo["relationship"][kumar - 1]["Compatibility"]}`;

						sendTextMessage(sender, comp);
						

					}else {
						console.error(response.error);
					}
				});
			} else {
				console.log("2nd error");
				sendTextMessage(sender, responseText);
			}
		break;

	case "name-num-izo":
			if (parameters.hasOwnProperty("full-name") && parameters["full-name"]!='') {

					var mennt = parameters["full-name"];

					function nameNum() {
					var x = {A:1, I:1, J:1, Q:1, Y:1, B:2, K:2, R:2, C:3, G:3, 
				    L:3, S:3, D:4, M:4, T:4, E:5, H:5, N:5, X:5, U:6, V:6, W:6, 
				    O:7, Z:7, F:8, P:8};
				    
				    var name = parameters["full-name"]; //for example: TOM
				    var nameScore = 0;
					var name = name.replace(/[^a-z]/gi, '');
					    name = name.toUpperCase();
					    var letters = name.split("")

				    for( var i = 0; i < letters.length; i++ )
				    {
				    	var curChar = name.charAt( i );
				    	var curValue = x[ curChar ];
				    	nameScore = nameScore + curValue;
				    }//for()
				    
				    console.log("your name number will be" + nameScore);
				    return nameScore;
				 }
										
				var naNumber = nameNum();
				var request = require('request');

				request({
					url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1q3rIySAH_YYclQm4pEUjaKfgqQBVJWp3im0dUDocM_w&sheet=nameNum&authuser=1',
	
				}, function(error, response, body) {
					if(!error && response.statusCode == 200) {
						let nameIzo = JSON.parse(body);
						let nameanaly = `${nameIzo["nameNum"][naNumber - 11]["Name_Numbers_and_their_Meanings"]}`;

						sendTextMessage(sender, nameanaly);
						

					}else {
						console.error(response.error);
					}
				});
				
			} else {
				console.log("2nd error");
				sendTextMessage(sender, responseText);
			}
		break;

		//Marriage Calculation
		case "izo-marriage":
			// if (parameters.hasOwnProperty("mar-dod") && parameters["mar-dod"] =='') {
				userdata.readUserMarriagedata(function(marriage_data) {
				let reply = `${marriage_data}`;
				if (reply != 'null') {
					sendTextMessage(sender, reply);
				}else { 
					userdata.readUserDob(function(dob) {
					var nameDob = `${dob}`;

					function MainPynum(){
						 function mainpynum(){
							 
							 var splitDate = nameDob.replace(/[^0-9]/g, '');
							 var lastDate = splitDate.slice(6, 8);

					         var value = lastDate,
					         sum = 0;
					        
					         while (value) {
					            sum += value % 10;
					            value = Math.floor(value / 10);
					         }
					        
					        return (sum);
						 }
					 return mainpynum();
					}

					var psyNum = MainPynum();

					var birthdate = new Date(nameDob);
					var cur = new Date();
					var diff = cur-birthdate; // This is the difference in milliseconds
					var age = Math.floor(diff/31557600000); // Divide by 1000*60*60*24*365.25

					var request = require('request');

					request({
						url: 'https://script.google.com/macros/s/AKfycbygukdW3tt8sCPcFDlkMnMuNu9bH5fpt7bKV50p2bM/exec?id=1rC5Qtk51iTXromDvcHlsdorCA9DQ1dmqqepeqX7J-mA&sheet=fullmarriageflow&authuser=1',
		
					}, function(error, response, body) {
						if(!error && response.statusCode == 200) {
							//let nameIzo = JSON.parse(body);
							let flowData = JSON.parse(body);
							let flowMain = flowData.fullmarriageflow;
							console.log(psyNum);

							let singleData = flowMain.filter(function (el) {
							    // here is condition
							    return (el.Psychic_Number === psyNum && el.Age === age);
							}).sort(function(el) {
								return el.Results;
							});
							console.log(singleData);
							let fullMarrData = `${singleData[0]["Results"]}`;
							
							sendTextMessage(sender, fullMarrData);
							userdata.userMarriageData(sender, age, fullMarrData);
							
						}else {
							console.error(response.error);
						}
					});	
				 }, sender
				 )
				}
			  }, sender
		    )
		// } else {
		// 	console.log("2nd error");
		// 	sendTextMessage(sender, responseText);
		// }
		break;

		case "google-db":
			 if (parameters.hasOwnProperty("mar-dod") && parameters["date-google"] && parameters["name-google"] =='') {
			 	var name = parameters["name-google"];
			 	userdata.testData(sender, name);				
		} else {
			console.log("2nd error");
			sendTextMessage(sender, responseText);
		}

		break;
		default:
			//unhandled action, just send back the text
			sendTextMessage(sender, responseText);
}
}
function handleMessage(message, sender) {
	switch (message.type) {
		case 0: //text
			sendTextMessage(sender, message.speech);
			break;
		case 2: //quick replies
			let replies = [];
			for (var b = 0; b < message.replies.length; b++) {
				let reply =
				{
					"content_type": "text",
					"title": message.replies[b],
					"payload": message.replies[b]
				}
				replies.push(reply);
			}
			sendQuickReply(sender, message.title, replies);
			break;
		case 3: //image
			sendImageMessage(sender, message.imageUrl);
			break;
		case 4:
			// custom payload
			var messageData = {
				recipient: {
					id: sender
				},
				message: message.payload.facebook

			};

			callSendAPI(messageData);

			break;
	}
}


function handleCardMessages(messages, sender) {

	let elements = [];
	for (var m = 0; m < messages.length; m++) {
		let message = messages[m];
		let buttons = [];
		for (var b = 0; b < message.buttons.length; b++) {
			let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
			let button;
			if (isLink) {
				button = {
					"type": "web_url",
					"title": message.buttons[b].text,
					"url": message.buttons[b].postback
				}
			} else {
				button = {
					"type": "postback",
					"title": message.buttons[b].text,
					"payload": message.buttons[b].postback
				}
			}
			buttons.push(button);
		}


		let element = {
			"title": message.title,
			"image_url":message.imageUrl,
			"subtitle": message.subtitle,
			"buttons": buttons
		};
		elements.push(element);
	}
	sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 && i == messages.length - 1) {
				cardTypes.push(messages[i]);
                		timeout = (i - 1) * timeoutInterval;
                		setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                		cardTypes = [];
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
		handleApiAiAction(sender, action, responseText, contexts, parameters);
	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			console.log('Response as formatted message' + responseData.facebook);
			sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {

		sendTextMessage(sender, responseText);
	}
}

function sendToApiAi(sender, text) {

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sessionIds.get(sender)
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: imageUrl
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: config.SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: config.SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: config.SERVER_URL + videoName
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "file",
				payload: {
					url: config.SERVER_URL + fileName
				}
			}
		}
	};

	callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: text,
					buttons: buttons
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: elements
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
							timestamp, elements, address, summary, adjustments) {
	// Generate a random receipt ID as the API requires a unique ID
	var receiptId = "order" + Math.floor(Math.random() * 1000);

	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: recipient_name,
					order_number: receiptId,
					currency: currency,
					payment_method: payment_method,
					timestamp: timestamp,
					elements: elements,
					address: address,
					summary: summary,
					adjustments: adjustments
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text,
			metadata: isDefined(metadata)?metadata:'',
			quick_replies: replies
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons: [{
						type: "account_link",
						url: config.SERVER_URL + "/authorize"
          }]
				}
			}
		}
	};

	callSendAPI(messageData);
}


function greetUserText(userId) {

	let user = usersMap.get(userId);

	let replies = [
				{
					"content_type":"text",
					"title":"Start izo",
					"payload":"Start izo"
				}
			];
	sendQuickReply(userId, "Welcome " + user.first_name + " " + user.last_name + "!" + "\nI am IZO, your Personal Astrologer" + 
				" and Numerologist. Talk to me Anytime. Anywhere.", replies);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfPostback = event.timestamp;

	setSessionAndUser(senderID);
	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	var payload = event.postback.payload;

	switch (payload) {
		case 'GET_STARTED':
		    greetUserText(senderID);
			break;

		case 'ABOUT_IZO':
		    sendTextMessage(senderID, "izo.ai is an Artificial Intelligent bot which predicts your future." +
		    	"It uses the latest Machine Learning and AI techniques to predict your future using the " +
		    	"knowledge of experienced Astrologer and Numerologist Rohit K Singhania.");
			break;

		case 'CONTACT_INFO':
		    sendTextMessage(senderID, "Rohit K Singhania" + "\n" + 
		    	"Email us : rohit@izofy.com " + "\n" +
		    	"Call me : +919836133350");
			break;

		default:
			//unindentified payload
			sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
			break;

	}

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger'
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
