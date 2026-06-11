(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var spans=doc.querySelectorAll('span');
  for(var i=0;i<spans.length;i++){
    var t=spans[i].innerText;
    if(t.indexOf('Agent')>=0&&t.indexOf('30')>=0&&spans[i].offsetHeight>0){
      spans[i].click();
      return 'trigger';
    }
  }
  return 'no';
})()