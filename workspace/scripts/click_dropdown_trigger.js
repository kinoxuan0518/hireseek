(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('DIV');
  for(var i=0;i<all.length;i++){
    var h=all[i].offsetHeight;
    if(h<1){continue;}
    var t=all[i].innerText;
    if(t.indexOf('Agent 开发工程师')!=-1&&t.length<60){
      all[i].click();
      return String('clicked '+all[i].tagName);
    }
  }
  return 'none';
})()