(function(){
  var items=document.querySelectorAll('.geek-item');
  for(var i=0;i<items.length;i++){
    if(items[i].innerText.indexOf('CANDIDATE_NAME')!=-1){
      items[i].click();
      return 'clicked';
    }
  }
  return 'not_found';
})()