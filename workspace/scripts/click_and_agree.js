(function(){
  var items=document.querySelectorAll('.geek-item');
  var target='祝筱妍';
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf(target)!=-1){
      items[i].click();
      return 'clicked_'+target;
    }
  }
  return 'not_found_'+target;
})()