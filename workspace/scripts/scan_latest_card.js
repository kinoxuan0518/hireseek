(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var ul=doc.querySelector('ul.recommend-card-list');
  if(!ul){return 'no_ul';}
  var lis=ul.querySelectorAll('li');
  var r=[];
  for(var i=0;i<lis.length;i++){
    var txt=lis[i].innerText;
    r.push(i+':'+txt.substring(0,80).replace(/\n/g,' | '));
  }
  return String(r.join('||'));
})()