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
	
	set out to ""
	
	-- 1. 985
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='985'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "985:" & r & " "
	delay 1
	
	-- 2. 国内外名校
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='国内外名校'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "名校:" & r & " "
	delay 1
	
	-- 3. 在校/应届
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='在校/应届'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "应届:" & r & " "
	delay 1
	
	-- 4. 25年毕业
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='25年毕业'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "25:" & r & " "
	delay 1
	
	-- 5. 26年毕业
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='26年毕业'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "26:" & r & " "
	delay 1
	
	-- 6. 1年以内
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='1年以内'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "1y:" & r & " "
	delay 1
	
	-- 7. 1-3年
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var items=doc.querySelectorAll('div.option');for(var i=0;i<items.length;i++){if(items[i].innerText.trim()==='1-3年'){items[i].click();return 'done';}}return 'notfound';})()"
	set r to execute tab_ javascript js
	set out to out & "13y:" & r & " "
	delay 1
	
	return out
end tell