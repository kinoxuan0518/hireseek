(function(){
  var items=document.querySelectorAll('.geek-item');
  for(var i=0;i<items.length;i++){
    var txt=items[i].innerText;
    if(txt.indexOf('张希')!=-1){
      items[i].click();
      return 'clicked_zhangxi';
    }
  }
  return 'not_found';
})()