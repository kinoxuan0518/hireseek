(function(){
  var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');
  if(cards.length==0){
    var ul=document.querySelector('iframe').contentDocument.querySelector('ul.recommend-card-list');
    if(ul){cards=ul.querySelectorAll('li');}
  }
  for(var i=0;i<cards.length;i++){
    var txt=cards[i].innerText;
    var btn=cards[i].querySelector('.btn-greet');
    if(!btn){continue;}
    if(txt.indexOf('27年')!=-1||txt.indexOf('28年')!=-1){continue;}
    if(txt.indexOf('10年以上')!=-1){continue;}
    btn.scrollIntoView();
    btn.click();
    return String('greeted_'+i);
  }
  return 'none';
})()