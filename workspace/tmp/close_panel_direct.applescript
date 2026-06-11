tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var iframe=document.querySelector('iframe'); var doc=iframe.contentDocument; if(!doc){doc=iframe.contentWindow.document} var filterLabel=doc.querySelector('.filter-label'); if(filterLabel){filterLabel.click();String('toggled')}else{String('no_label')}"
	return resultText
end tell