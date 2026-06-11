(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var all=doc.querySelectorAll('li');
  var r=[];
  for(var i=0;i<all.length;i++){
    if(all[i].offsetHeight>0){
      r.push(i+':'+all[i].innerText.substring(0,40));
    }
  }
  return String(r.join('||'));
})()