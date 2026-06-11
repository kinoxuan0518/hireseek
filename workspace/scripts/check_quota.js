(function(){
  var items=document.querySelectorAll('a,span,div');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('招聘数据')>=0&&items[i].offsetHeight>0){
      items[i].click();
      return 'clicked';
    }
  }
  return 'not_found';
})()