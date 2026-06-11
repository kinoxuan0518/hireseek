(function(){
  var iframe=document.querySelector('iframe');
  if(!iframe){return 'no_iframe';}
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  return String(doc.body.innerText.substring(0,200));
})()