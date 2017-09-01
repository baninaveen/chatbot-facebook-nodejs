'use strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');
pg.defaults.ssl = true;

const pool = new pg.Pool(config.PG_CONFIG);
pool.connect();
// const client = new pg.Client(db_url);
// client.connect();

// var db_url = "postgres://rtkybbbvnorvjb:ab96d298a9e0f3f3d1e32f387853252f56bf5a68ce93e929c79c0cf78b5370a4@ec2-54-227-237-223.compute-1.amazonaws.com:5432/dfk4kqljdci4bd";


module.exports = {

    storeUserData: function(userId, dob, gender, username, pNum, pData, dNum, dData, characteristics, pTraits, nTraits, lColor, lNum, lDay, lGem, uColor, uDay, uNum) {  
	    // pool.connect(function(err, client, done) {
     //        if (err) {
     //            return console.error('Error acquiring client', err.stack);
     //            }
                 let sql1 = `SELECT id FROM user_izo_data WHERE fb_id='${userId}' LIMIT 1`;
        	     pool
        	         .query(sql1,
        	             function(err, result) {
        	                 if (err) {
        	                     console.log('Query error: ' + err);
        	                 } else {
        	                     console.log('rows: ' + result.rows.length);
        	                         let sql = 'INSERT INTO public.user_izo_data (fb_id, dob, gender, user_name, psy_no, psy_data, dest_no, dest_data, characteristics, post_traits, neg_traits, lucky_color, lucky_number, lucky_day, lucky_gemstone, unlucky_color, unlucky_day, unlucky_num) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)';
        	 
        	                         pool.query(sql,
        	                         [
        	                             userId,
        	                             dob,
        	                             gender,
        	                             username,
        	                             pNum,
        	                             pData,
        	                             dNum,
        	                             dData,
        	                             characteristics,
        	                             pTraits,
        	                             nTraits,
        	                             lColor,
        	                             lNum,
        	                             lDay,
        	                             lGem,
        	                             uColor,
        	                             uDay,
        	                             uNum
        	                       ]);
                                done();
        	                     
        	                 }
        	             });
                    
       //}); 
        pool.end();
},
  userNameData: function(userId, nameData) {   // Name analysis data Store Name Data
	     pool.connect(function(err, client, done) {
	     if (err) {
	         return console.error('Error acquiring client', err.stack);
	     }
	     let sql1 = `SELECT id FROM user_izo_data WHERE fb_id='${userId}' LIMIT 1`;
	     client
	         .query(sql1,
	             function(err, result) {
	                 if (err) {
	                     console.log('Query error: ' + err);
	                   done(err);
	                 } else {
	                     console.log('rows: ' + result.rows.length);
	                         let sql = 'UPDATE public.user_izo_data SET name_data=$2 WHERE fb_id=$1';
	 
	                         client.query(sql,
	                         [
	                             userId,	                
	                             nameData
	                       ], done);
	                 }
	             });
	 });
     pool.end();
},
userMarriageData: function(userId, ageUser, marriageData) {   // Marriage Data
	     // pool.connect(function(err, client, done) {
	     // if (err) {
	     //     return console.error('Error acquiring client', err.stack);
	     // }
	     let sql1 = `SELECT id FROM user_izo_data WHERE fb_id='${userId}' LIMIT 1`;
	     client
	         .query(sql1,
	             function(err, result) {
	                 if (err) {
	                     console.log('Query error: ' + err);
	                   //done(err);
	                 } else {
	                     console.log('rows: ' + result.rows.length);
	                         let sql = 'UPDATE public.user_izo_data SET age=$2, marriage_data=$3 WHERE fb_id=$1';
	 
	                         client.query(sql,
	                         [
	                             userId,
	                             ageUser,	                
	                             marriageData
	                       ]);
	                 }
	             });
	 //});
    pool.end();
},
userComptibleData: function(userId, compData) {   // Compatible Data
	     pool.connect(function(err, client, done) {
	     if (err) {
	         return console.error('Error acquiring client', err.stack);
	     }
	     let sql1 = `SELECT id FROM user_izo_data WHERE fb_id='${userId}' LIMIT 1`;
	     client
	         .query(sql1,
	             function(err, result) {
	                 if (err) {
	                     console.log('Query error: ' + err);
	                   done(err);
	                 } else {
	                     console.log('rows: ' + result.rows.length);
	                         let sql = 'UPDATE public.user_izo_data SET compatible=$2 WHERE fb_id=$1';
	 
	                         client.query(sql,
	                         [
	                             userId,                
	                             compData
	                       ], done);
	                 }
	             });
	 });
    pool.end();
},
readUserChardata: function(callback, userId) { // Read Charactriestics Data from DB
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT characteristics FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['characteristics']);
                        };
                    });
        });
    },
    readUserPtraitsdata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT post_traits FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['post_traits']);
                        };
                    });
        });
        pool.end();
    },
    readUserNtraitsdata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT neg_traits FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['neg_traits']);
                        };
                    });
        });
    },
    readUserLcolordata: function(callback, userId) { // Lucky Color
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT lucky_color FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['lucky_color']);
                        };
                    });
        });
    },
    readUserLnumberdata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT lucky_number FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['lucky_number']);
                        };
                    });
        });
    },
    readUserLdaydata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT lucky_day FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['lucky_day']);
                        };
                    });
        });
    },
    readUserLgemstonedata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT lucky_gemstone FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['lucky_gemstone']);
                        };
                    });
        });
    },
    readUserUcolordata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT unlucky_color FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['unlucky_color']);
                        };
                    });
        });
    },
    readUserUdaydata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT unlucky_day FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['unlucky_day']);
                        };
                    });
        });
    },
    readUserUnumberdata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT unlucky_num FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['unlucky_num']);
                        };
                    });
        });
    },
    readUserNamedata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
                return console.error('Error acquiring client', err.stack);
            }
            client
                .query(
                    'SELECT name_data FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['name_data']);
                        };
                    });
        });
        pool.end();
    },
    readUserMarriagedata: function(callback, userId) {
        // pool.connect(function(err, client, done) {
        //     if (err) {
        //         return console.error('Error acquiring client', err.stack);
        //     }
            pool
                .query(
                    'SELECT marriage_data FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            //done(err);
                        } else {
                            callback(result.rows[0]['marriage_data']);
                        };
                    });
        // });
        pool.end();
    },
    
    readUserCompatibledata: function(callback, userId) {
        pool.connect(function(err, client, done) {
            if (err) {
               return console.error('Error acquiring client', err.stack);
           }
            client
                .query(
                    'SELECT compatible FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            done(err);
                        } else {
                            callback(result.rows[0]['compatible']);
                        };
                    });
        });
        pool.end();
    },
    readUserDob: function(callback, userId) {   
        // pool.connect(function(err, client, done) {
        //     if (err) {
        //        return console.error('Error acquiring client', err.stack);
        //    } 
            pool
                .query(
                    'SELECT dob FROM public.user_izo_data WHERE fb_id=$1',
                    [userId],
                    function(err, result) {
                        if (err) {
                            console.log(err);
                            callback('');
                            //done(err);
                        } else {
                            callback(result.rows[0]['dob']);
                        };
                    });
    //});
    pool.end();
   
},
testData: function(userId, data) {   // Marriage Data
         pool.connect(function(err, client, done) {
         if (err) {
             return console.error('Error acquiring client', err.stack);
         }
         let sql1 = `SELECT id FROM user_izo_data WHERE fb_id='${userId}' LIMIT 1`;
         client
             .query(sql1,
                 function(err, result) {
                     if (err) {
                         console.log('Query error: ' + err);
                       //done(err);
                     } else {
                         console.log('rows: ' + result.rows.length);
                             let sql = 'UPDATE public.user_izo_data SET data=$2 WHERE fb_id=$1';
     
                             client.query(sql,
                             [
                                 userId,
                                 data
                           ],done);
                     }
                 });
     });
    pool.end();
},
}