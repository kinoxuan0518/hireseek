tell application "Google Chrome"
	set resultText to execute tab 2 of window 1 javascript "var el=document.querySelector('.menu-recommend a'); if(el){el.click();String('clicked')}else{String('not_found')}"
	return resultText
end tell