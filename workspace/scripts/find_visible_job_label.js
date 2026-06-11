(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('*');
  var r='';
  for(var i=0;i<all.length;i++){
    var t=all[i].innerText;
    if(t.indexOf('Agent 开发工程师')>=0&&all[i].offsetHeight>0&&all[i].children&&all[i].children.length<3){
      r+=i+':'+t.substring(0,40)+'|tag='+all[i].tagName+'|cls='+(all[i].className||'none')+'\n';
    }
  }
  return r||'none';
})()