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
	
	-- Step 1: Click dropdown trigger - find span showing Agent
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var spans=doc.querySelectorAll('span');for(var i=0;i<spans.length;i++){var t=spans[i].innerText;if(t.indexOf('Agent')>=0&&t.indexOf('30')>=0&&spans[i].offsetHeight>0){spans[i].click();return 'trigger';}}return 'no';})()"
	set r to execute tab_ javascript js
	delay 1
	
	-- Step 2: Click big model
	set js2 to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var lis=doc.querySelectorAll('li');for(var i=0;i<lis.length;i++){var t=lis[i].innerText;if(t.indexOf('大模型')>=0&&lis[i].offsetHeight>0){lis[i].scrollIntoView();lis[i].click();return 'job';}}return 'no';})()"
	set r2 to execute tab_ javascript js2
	delay 2
	
	return r & '|' & r2
end tell