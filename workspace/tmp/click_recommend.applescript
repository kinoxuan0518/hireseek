tell application "Google Chrome"
	execute tab 2 of window 1 javascript "document.querySelector('.menu-recommend a').click(); String('clicked')"
end tell