(function(){
  var items=document.querySelectorAll('.geek-item');
  for(var i=0;i<items.length;i++){
    if(items[i].innerText.indexOf('余女士')!=-1){
      items[i].click();
      return 'clicked';
    }
  }
  return 'not_found';
})()