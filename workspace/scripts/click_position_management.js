(function(){
  var items=document.querySelectorAll('A');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('职位管理')!=-1&&items[i].offsetHeight>0){
      items[i].click();
      return String('clicked_职位管理');
    }
  }
  return 'none';
})()