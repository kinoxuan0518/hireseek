tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var cards=doc.querySelectorAll('li'); for(var ci=0;ci<cards.length;ci++){var nameEl=cards[ci].querySelector('.name');if(!nameEl){continue}if(nameEl.innerText.trim()=='吴其乐'){String(cards[ci].querySelectorAll('button').length+','+cards[ci].querySelectorAll('a').length+','+cards[ci].querySelectorAll('.btn').length+','+cards[ci].innerHTML.substring(0,300))}break}"
	return resultText
end tell