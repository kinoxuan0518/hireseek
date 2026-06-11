(function(){
  var items=document.querySelectorAll('.geek-item');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('白红霞')!=-1){
      items[i].click();
      return 'clicked_bai';
    }
  }
  return 'not_found';
})()