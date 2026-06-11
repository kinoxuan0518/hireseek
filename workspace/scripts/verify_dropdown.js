(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var items=doc.querySelectorAll('li.job-item');
  var r=[];
  for(var i=0;i<items.length;i++){
    if(items[i].offsetHeight>0){
      r.push(i+':visible:'+items[i].innerText.substring(0,30));
    }else{
      r.push(i+':hidden:'+items[i].innerText.substring(0,30));
    }
  }
  return r.join('||');
})()