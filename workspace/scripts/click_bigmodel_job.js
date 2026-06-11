(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var lis=doc.querySelectorAll('li');
  for(var i=0;i<lis.length;i++){
    var t=lis[i].innerText;
    if(t.indexOf('大模型')>=0&&lis[i].offsetHeight>0){
      lis[i].scrollIntoView();
      lis[i].click();
      return 'job_clicked';
    }
  }
  return 'no';
})()