(function(){
  var iframe=document.querySelector('iframe');
  if(!iframe){return 'no_iframe';}
  return String('src='+(iframe.src||'').substring(0,60)+'|len='+iframe.contentDocument.body.innerText.length);
})()