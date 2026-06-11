tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument || iframe.contentWindow.document; var cards=doc.querySelectorAll('li'); var names=''; for(var i=0;i<cards.length;i++) { var nameEl=cards[i].querySelector('.name'); if(nameEl) { names=names+nameEl.innerText.trim()+'|' } } String(names.substring(0,500))"
	return resultText
end tell