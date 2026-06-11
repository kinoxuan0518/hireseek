(function(){
  var items=document.querySelectorAll('span,div,a,li');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('沟通')!=-1&&items[i].offsetHeight>0&&t.length<5){
      items[i].click();
      return 'clicked_沟通';
    }
  }
  return 'not_found';
})()