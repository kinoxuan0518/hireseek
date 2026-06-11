(function(){
  var items=document.querySelectorAll('.geek-item');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('白红霞')!=-1){
      items[i].click();
      return String('clicked_白红霞_idx_'+i);
    }
  }
  return 'not_found';
})()