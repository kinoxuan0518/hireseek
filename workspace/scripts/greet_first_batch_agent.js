(function(){
  var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');
  var r=[];
  var targets=[3,4,5,6,7,9,10,11,13,14];
  for(var idx=0;idx<targets.length;idx++){
    var i=targets[idx];
    if(i>=cards.length){continue;}
    var card=cards[i];
    var btn=card.querySelector('.btn-greet');
    if(!btn){continue;}
    btn.scrollIntoView();
    btn.click();
    r.push('greeted_'+i);
    break;
  }
  return String(r.join('||')||'no_more');
})()