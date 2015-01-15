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

  io.on('connection', function (socket) {
    var addedUser = false;

    // when the client emits 'new message', this listens and executes
    socket.on('new message', function (data) {
      // we tell the client to execute 'new message'
      socket.broadcast.emit('new message', {
        username: socket.username,
        message: data
      });
    });

    // when the client emits 'add user', this listens and executes
    socket.on('add user', function (username, password) {
      con.log(password);
      // we store the username in the socket session for this client
      socket.username = username;
      // add the client's username to the global list
      usernames[username] = username;
      ++numUsers;
      addedUser = true;
      socket.emit('login', {
        numUsers: numUsers
      });
      // echo globally (all clients) that a person has connected
      socket.broadcast.emit('user joined', {
        username: socket.username,
        numUsers: numUsers
      });
    });

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

        // echo globally that this client has left
        socket.broadcast.emit('user left', {
          username: socket.username,
          numUsers: numUsers
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
