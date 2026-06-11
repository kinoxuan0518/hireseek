(function(){
  var iframe=document.querySelector('iframe');
  var doc=iframe.contentDocument||iframe.contentWindow.document;
  var tabs=doc.querySelectorAll('.tab-item');
  for(var i=0;i<tabs.length;i++){
    if(tabs[i].innerText.indexOf('推荐')>=0){
      tabs[i].click();
      return 'clicked_recommend';
    }
  }
  return 'not_found';
})()