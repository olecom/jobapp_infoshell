#!/bin/sh

if [ "$1" = 'devel' -o "$NODE_ENV" = 'devel' ]
then
    echo '
---- Development mode ----
> NODE_ENV=devel npm start
> sh _start.sh devel
* ENTER  -- kill && reload node.js
* CTRL+C -- stop (console HUP)
'
    NODE_ENV='development'
    export NODE_ENV
    while sh _start.sh
    do
        node app.js&
        B=$!
        echo "developemnt mode node.js PID: $B"
        read A
        kill $B
    done
    exit 2
fi

set -e
trap 'echo "
Unexpected Script Error! Use /bin/sh -x $0 to trace it.
"
set +e
trap "" 0
exit 0
' 0 # catch errors

echo 'Compilling "./client/index.htm"...'
cd './client'

css(){
    echo "
/$1/{
  r $1
  a \
  /*]]>*/</style>
  c \
  <style>/*<![CDATA[ $1 */
}"
}

js(){
    echo "
/$1/{
  r ${2:-$1}
  a \
  /*]]>*/</script>
  c \
  <script>/*<![CDATA[ $1 */
}"
}

no_blanks(){
    echo '
s/^[[:blank:]]*//
/^$/d
'
}

no_comments(){
    echo '
# skip some CDATA and CSS
/^[/][*][]<]/b
# delete C++ comments
/^[/][/]/d
# delete whole line(s) C comments
/^[/][*]/{
:_line
  /[*][/]$/d
  N
  b_line
}'
}

sed "
`css style.css`
`js main.js`
`js jquery-1.10.2.min.js ../www_modules/jquery-1.10.2.min.js`
`js socket.io.js ../node_modules/socket.io/node_modules/socket.io-client/socket.io.js`
" <index.html | sed "
`no_blanks`
`no_comments`
"'
s/$/\r/
' >index.htm
cd ..
trap '' 0
echo 'Done'

[ 'development' = "$NODE_ENV" ] || {
    echo 'Starting `node app.js`...'
    exec node app.js
}
exit 0
