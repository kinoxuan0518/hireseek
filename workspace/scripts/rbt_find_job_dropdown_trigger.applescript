tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var links=doc.querySelectorAll('a');var r='';for(var i=0;i<links.length;i++){var t=links[i].innerText;if(t.indexOf('Agent')>=0||t.indexOf('大模型')>=0||t.indexOf('开发工程师')>=0){r+=i+':a:'+t.substring(0,50)+' ';}}var divs=doc.querySelectorAll('.job-selector, .job-dropdown, .ui-dropmenu, [class*=job]');for(var i=0;i<divs.length;i++){var txt=divs[i].innerText.substring(0,80);if(txt.length>5)r+='div:'+txt+' ';}return r||'none';})()"
	set r to execute tab_ javascript js
	return r
end tell