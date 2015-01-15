/*
 */

(function launchChatApp(proc, con){
  var server = require('http').createServer(resStatic);
  var fs = require('fs');

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
      return sendHTMLFile('/client/index.html')(req, res);// manually crafted
      // or using `send` module:
      /*  return require('send')(req, __dirname + '/client/index.html')
           .on('error', function(err) { con.log('ERROR send:', err); })
           .pipe(res); */
    };
    return res.end();
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
})(process, console);
