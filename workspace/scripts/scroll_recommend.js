(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var container=doc.querySelector('.list-body')||doc.body;
  var h=container.scrollHeight;
  container.scrollTop=h;
  return String(h);
})()