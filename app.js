/*
 */

(function launchChatApp(proc, con){
  var server = require('http').createServer(resStatic);
  var fs = require('fs');
  var api = {
    db: null,
    shutdownHandlers: [ ]// run all this functions before exit
  };

  // launch mongodb and connect to it then

  require('./mongodb').launch(api,{
    callback: runSocketIO,

    db_path: __dirname + '/data/',
    bin: __dirname + '/data/mongod'
  });

  // server setup

  proc.env.NODE_PORT = proc.env.NODE_PORT || 3000;

  server.on('error', function http_server_error(e){
    if('EADDRINUSE' == e.code){
      con.log("FATAL: can't listen port (collision): " + proc.env.NODE_PORT);
    } else {
      con.log('ERROR in server: ', e);
    }
  });

  server.on('clientError', function http_client_error(err){
    con.log('ERROR in client connection: ', err);
  });

  server.listen(proc.env.NODE_PORT, function http_listen(){
    con.log('Server listening at port: ' + proc.env.NODE_PORT);
  });

  function resStatic(req, res){
    con.log(req.url);

    if('/' == req.url){
      return sendHTMLFile('/client/index.htm')(req, res);// manually crafted
      // or using `send` module:
      /*  return require('send')(req, __dirname + '/client/index.htm')
           .on('error', function(err) { con.log('ERROR send:', err); })
           .pipe(res); */
    }

    if('/shutdown' == req.url && api){
      return shutdown(res);
    }
    return res.end();
  }

  // ==== from socket.io example: Chatroom ====

  function runSocketIO(){
    // usernames which are currently connected to the chat
    var io = require('socket.io')(server);
    var usernames = {};
    var numUsers = 0;
    var Users = api.db.getCollection('Users');

    Users.ensureIndex({ u: 1 },{ unique: true  }, function(err) {
      err && con.log('Users.ensureIndex(u):', err);
    });

    io.on('connection', function (socket) {
      var addedUser = false;

      // when the client emits 'new message', this listens and executes
      socket.on('new message', function (username, msg) {
        // we tell the client to execute 'new message'
        socket.broadcast.emit('new message', {
          username: username,
          message: msg
        });
      });

      // when the client emits 'add user', this listens and executes
      socket.on('add user', doAuth);

      function doAuth(username, password) {
        return Users.findOne(
          { u: username },
        function (err, uid){
          if(err) return con.log('!Users.findOne:', err);

          var time = new Date;

          //con.log('uid:', uid);
          //con.log('socket.id:', socket.id );
          if(!uid){
            uid = { u: username, p: password };
            uid[socket.id] = time;
            return Users.insert(uid,
            function(err, sid){
              if(err) return con.log('!Users.insert(new):', err);
              return doLogin(sid[0].u, time);
            });
          }

          if(uid.p === password){
            if(uid[socket.id]){// old socket
              con.log('== old sock ==');
              con.log(uid);
              return doLogin(username, uid[socket.id]);
            }
            // new socket
            uid = { };
            uid[socket.id] = time;
            return Users.findAndModify(
              { u: username },
              [ ],// sort
              { $set: uid },// update socket id time
            function (err, sid){
              if(err) return con.log('Users.findAndModify(add sock):', err);
              con.log('== add sock ==');
              con.log(sid);
              return doLogin(sid.u, time);
            });
          }
          // todo prevent brute force attack
          socket.emit('err pass', username);
        });
      }

      function doLogin(username, time) {
        time = getClock(time);// => '[16:53:06]'
        // we store the username in the socket session for this client
        socket.username = username;
        // add the client's username to the global list
        usernames[username] = username;
        ++numUsers;
        addedUser = true;
        socket.emit('login', {
          time: time,
          numUsers: numUsers
        });
        // echo globally (all clients) that a person has connected
        socket.broadcast.emit('user joined', {
          username: socket.username,
          numUsers: numUsers
        });
      }

      // when the client emits 'typing', we broadcast it to others
      socket.on('typing', function () {
        socket.broadcast.emit('typing', {
          username: socket.username
        });
      });

      // when the client emits 'stop typing', we broadcast it to others
      socket.on('stop typing', function () {
        socket.broadcast.emit('stop typing', {
          username: socket.username
        });
      });

      // when the user disconnects.. perform this
      socket.on('disconnect', function () {
        // remove the username from global usernames list
        if (addedUser) {
          delete usernames[socket.username];
          --numUsers;
          addedUser = false;

          // echo globally that this client has left
          socket.broadcast.emit('user left', {
            username: socket.username,
            numUsers: numUsers
          });

          var sock = { };
          sock[socket.id] = 1;

          return Users.findAndModify(
            { u: socket.username },
            [ ],// sort
            { $unset: sock },// remove socket from user
          function (err, uid) {
            if(err) return con.log('Users.findAndModify(del sock):', err);
            con.log(uid);
            return;
          });
        }
      });
    });
    con.log('Socket.io is ready to chat');
    api.db.collectionNames(function(err ,arr){
      con.log(err || arr);
    });
  }

  // ==== tools ====

  function getClock(d){
    function pad(n){ return n<10 ? '0'+n : n; }

    return '[' +
      pad(d.getUTCHours())+':'+
      pad(d.getUTCMinutes())+':'+
      pad(d.getUTCSeconds())+']';
  }

  function sendHTMLFile(name, absolute, start, end){// simple static file sender
    return function sendFile(r__, res){
      var fstream = fs.createReadStream(
        ( absolute ? '' : __dirname) + name,
        { start: start, end: end }
      );

      fstream.on('open', function on_fstream_open(fd){
        return fs.fstat(fd, function on_fstat(err, stat){
          if(err){
            res.statusCode = 500;
            con.log('ERROR fs.stat:', err);
            return res.end(err.code || String(err));
          }
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Content-Type',{
            'Content-Type': 'text/html; charset=utf-8'
          });
          return fstream.pipe(res);
        });
      });

      fstream.on('error', function on_fstream_error(err){
        con.log('ERROR send:', err);
        return res.end('error sending html to you');
      });

      res.on('close', function(){
        con.log('ERROR res close');
        return fstream.destroy();
      });

    };
  }

  function shutdown(res){
    var i, arr, code;

    arr = api.shutdownHandlers;
    for(i = 0; i < arr.length; ++i){
      arr[i](next);
    }
    i = arr.length;
    return (api = null);// prevent successive runs

    function next(err, data){
      err  && con.log('! end error at #' + (code = i) + '\n', err);
      data && res.write(data) && res.write('\n');
      if(0 === --i){
        the_end(code, res);
      }
    }

    function the_end(code, res){
      proc.nextTick(function(){
        con.log('$ application exit with code: ' + (code ? code : 0));
        proc.exit(code ? code : 0);
      });
      return res.end();
    }
  }

})(process, console);
