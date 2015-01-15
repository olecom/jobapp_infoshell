/*
 * Start/Restart/Stop mongodb service (daemon)
 * Setup robust MongoDB connection using native driver
 * NOTE default port = 27727
 */
(function MongoDB(module, con){

/* ,-< Stop mongod Processes >-
 * |
 * |In a clean shutdown a mongod completes all pending operations,
 * |flushes all data to data files, and closes all data files.
 * |Other shutdowns are unclean and can compromise the validity the data files.
 * |
 * `-<http://docs.mongodb.org/manual/tutorial/manage-mongodb-processes/>
 *
 * Our Clean shutdown stratery is to run
 * > db.admin.command({ shutdown: 1 })
 *
 * on shutdown event `mongod` will finish all pending requests (as per docs)
 * and then close event of `db` will free everything in the driver
 * no need of internal accounting and/or checking of
 * `serverStatus.metrics.cursor.open.total` on db.close()
 */

var mongodb = require('mongodb');
// module data
var mongod;// spawned daemon
var db, api, cfg;
var colls_cache = { };// collections which may have additional dynamic fields

// API for Mongodb access
var mongodbAPI = {
    client: null,// TODO?: setter, getter
    // methods
    launch: launch_daemon,
    connect: mongodb_connect
  };

  return module.exports = mongodbAPI;

function launch_daemon(app_api, config){
var cwd, d;

  if(!config || !app_api) throw new Error('!Undefined arguments')

  cfg = config;
  api = app_api;

  if(cfg.stop_on_restart) throw new Error('!Not implementd: "config.stop_on_restart"')

  cwd = cfg.db_path;
  try {
    d = require('fs').statSync(cwd);
  } catch(ex){ }
  if(!d || !d.isDirectory()){
    throw new Error(
      'Is not a directory (`mkdir` it): ' + (cwd ? cwd : '`cfg.db_path` is undefined')
    );
  }
  return spawn_mongod();
}

function pad(n){
  return n < 10 ? '0' + n : n;
}

function spawn_mongod(){
var cmd, cp, fs;

  fs = require('fs');
  cp = require('child_process');

  cmd = new Date;
  cfg.log_filename = cfg.db_path + cmd.getUTCFullYear()
                   + '-' + pad(cmd.getUTCMonth() + 1) + '.txt';
  cfg.bin = cfg.bin ? cfg.bin :'/usr/local/bin/mongod';

  cmd = {// check and apply defaults
    bin: cfg.bin,
    arg:(
      cfg.cmd_launch ||
      // optimizations (optional)
      '--noprealloc --smallfiles ' +
      // basic
      '--journal --directoryperdb --rest --httpinterface --quiet ' +
      // connection / path
      '--bind_ip 127.0.0.1 --port ' + (cfg.port || '27727') + ' --dbpath .'
    ).split(' '),
    opt:{
      cwd: cfg.db_path,
      detached: true,
      stdio:[
        'ignore'
        ,fs.openSync(cfg.log_filename,'a+')
        ,fs.openSync(cfg.log_filename,'a+')
      ]
    }
  };
  mongod = cp.spawn(cmd.bin, cmd.arg, cmd.opt);
  if(!mongod.pid || mongod.exitCode){
    throw new Error(
      '!FATAL spawn `mongod` exit code: ' + mongod.exitCode +
      '\n"cfg.bin": `' + cfg.bin + '`\n'
    )
  }
  mongod.on('close',
  function on_mongod_close(code){
    if(100 == code){
      // maybe `mongod` is running(lock), or try to restart
    } else if(0 != code){// unhandled
      throw new Error('!FATAL close `mongod` exit code: ' + code)
    }
    con.log('$ `mongod` stop');
    // `api.db` must receive 'close' event and clean up stuff
    return mongod = code;
  });
  con.log('^ `mongod` start pid:', mongod.pid);
  // connect `app` with `db`
  return mongodb_connect();
}

function mongodb_connect(app_api, config){
 /*
  * _ids are generated on Mongod's server side and play role only inside
  * local MongoDB.
  *
  * * NOTE: fatal errors and/or crashes inside DB callbacks can not use
  * *      `res.json()` to report UI and that. Timeout will fire in UI
  * *      and `bufferMaxEntries: 0` here do not retry any processing
  * */

  if(db){
    return con.log('Already connected');// permanent `db` setup for app
  };

  if(config && app_api){
    cfg = config;
    api = app_api;
  }
  // set defaults if needed
  if(!cfg.options) cfg.options = {
    db:{
      forceServerObjectId: true
     ,bufferMaxEntries: 0
     ,journal: true
    }
    ,server:{
      auto_reconnect: true
    }
  };
  if(!cfg.url) cfg.url = 'mongodb://127.0.0.1:' + (cfg.port || '27727') + '/';
  if(!cfg.db_name) cfg.db_name = 'socketioChat';

  return mongodb.MongoClient.connect(
    cfg.url + cfg.db_name, cfg.options, on_connect_app
  );
}//mongodb_connect

function on_connect_app(err ,newdb){
  if(err || !newdb){
    con.log('!Error MongoClient.connect:', err || '!`newdb`');
    return setTimeout(mongodb_connect, 4096);
  }

  db = mongodbAPI.client = newdb;
  db.on('error', function on_db_err(err){// see NOTE in mongodb_connect()
    db.status = '';
    err && con.log('!db error: ', err.stack || err);
  });
  db.on('timeout', function on_db_timeout(conn){
    db.status = '';
    conn && con.log('$db timeout: ' + conn.host + ':' + conn.port);
  });
  db.on('close', function on_db_close(conn){
    db.status = '';
    conn && con.log('$db close: ' + conn.host + ':' + conn.port);
  });

  db.on('reconnect', function on_db_close(conn){
    db_admin();
  });

  // `collection` from the driver is not the only thing we need here
  // there can be other info stored inside this objects e.g. `meta`
  db.getCollection = function getCollection(name){// using cache
    if(!colls_cache[name]){// name is `collectionName`
      colls_cache[name] = db.collection(name);
    }
    return colls_cache[name];
  };
  db.ObjectId = mongodb.ObjectID;

  return db_admin();

  function db_admin(){
    return db.admin(function on_admin(aerr ,a){
      if(aerr){
        con.log('db.admin():', aerr);
        return on_connect_app();// reconnect
      }
      return a.command({ buildInfo: 1 } ,function(e ,d){
        if(e){
          con.log('db.admin.command():', e);
          return on_connect_app();// reconnect
        }
        db.status = "MongoDB v" + d.documents[0]['version'];
        con.log('Connected to ' + db.status);

        api.shutdownHandlers && api.shutdownHandlers.push(end_with_mongodb);
        api.db = db;// finally provide `db`

        return cfg.callback && cfg.callback();
      });
    });//cb admin
  }
}

function end_with_mongodb(next){
  // clean database shutdown and thus app db connection
  if(!api.db){
    return next('$ end_with_mongodb(): no `api.db`');
  }

  return api.db.admin(
  function get_admin(aerr, a){
    if(aerr){
      return next('! mongo db.admin(): ' + aerr, aerr);
    }
    return a.command({ shutdown: 1 },
    function(err ,data){
      con.log('$ MongoDB shutdown data:', data ? data : err ? err : 'nothing');
      // `mongod` shuts down, thus it is not an error: connection closed
      return next(err && err.message != 'connection closed' ? err : void 0);
    }
    );
  }
  );
}
})(module, console);
