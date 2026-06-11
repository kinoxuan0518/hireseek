(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('span');
  var r=[];
  for(var i=0;i<all.length;i++){
    var t=all[i].innerText;
    if(t.indexOf('Agent')!= -1&&t.indexOf('开发工程')!= -1&&all[i].offsetHeight!=0){
      r.push(i+':'+t.substring(0,40));
    }
  }
  return String(r.join('||')||'none');
})()