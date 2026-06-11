tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument||iframe.contentWindow.document; var cards=doc.querySelectorAll('li'); var count=0; for(var ci=0;ci<cards.length;ci++){var nameEl=cards[ci].querySelector('.name'); if(nameEl&&nameEl.innerText.trim()=='王子涵'){count++}} String('found_'+count+'_times')"
	return resultText
end tell