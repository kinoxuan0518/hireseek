(function(){
  var items=document.querySelectorAll('span,button,div');
  for(var i=0;i<items.length;i++){
    var t=items[i].innerText;
    if(t.indexOf('同意')!=-1&&items[i].offsetHeight>0&&t.length<5){
      items[i].click();
      return String('clicked_agree '+items[i].tagName+' '+t.trim());
    }
  }
  return 'no_agree_btn_visible';
})()