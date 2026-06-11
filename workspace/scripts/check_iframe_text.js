(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  return String(doc.querySelectorAll('.card-item').length);
})()