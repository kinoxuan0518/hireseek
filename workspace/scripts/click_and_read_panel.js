(function(){
  var name='TARGET';
  var items=document.querySelectorAll('.geek-item');
  for(var i=0;i<items.length;i++){
    if(items[i].innerText.indexOf(name)!=-1){
      items[i].click();
      return 'clicked_'+name;
    }
  }
  return 'not_found_'+name;
})()