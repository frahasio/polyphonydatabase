// Autofill composers with values in first inclusion row
$( document ).ready(function(){
	$('.autofill-composers').click(function(){
		$('ul.composer li:first-child input').val($('ul.composer:first-of-type li:first-child input').val());
		$('ul.composer li:first-child select').val($('ul.composer:first-of-type li:first-child select').val());
	});
});

// Autoupdate voice count input as clefs are changed
$( document ).ready(function(){
	$('.clefs input').on('change', function(e){
	    	var rowIndex = $(this).closest('.body-row').index('.body-row');
	    	var tally = 0;
	    	var inputToUpdate = $('.body-row').eq(rowIndex).find('.voice-count input[data-composition-target="numberOfVoices"]');
		$('.body-row').eq(rowIndex).find('.clefs input').each(function(i,e) {
			if (!$(e).val() || $(e).attr('type') == 'hidden' || $(e).val().indexOf("(") !== -1 || $(e).val().indexOf(")") !== -1 || $(e).val().indexOf("bc") !== -1 || $(e).val().indexOf("lut") !== -1 || $(e).val().indexOf("org") !== -1) {
				// do nothing
			} else {
				tally = tally + 1;
			};
		});
		inputToUpdate.val(tally);
	});
});

// Toggle menu with burger button
$( document ).ready(function(){
	$('.burger').click(function(){
		$(this).parents('.nav').toggleClass('open');
	})
});

// Show extra attribution input
$( document ).ready(function(){
	$('.another-att-trigger').click(function(){
		$(this).siblings('.composer').find('li:last-of-type').addClass('visible');
	})
});

// Use arrow keys to move around clef inputs in source editor
$(document).keydown(
    function(e) {
	if ($(':focus').parent().parent().hasClass('clefs')) {
		var inp = $(':focus').parent().index();
		var sib = $(':focus').parent().siblings().length;
		var row = $(':focus').closest('.body-row').index('.body-row');
		var prevrow = $('.body-row').eq(row - 1).find('.clefs').children('input').length;
		if (e.keyCode == 38) {  //MOVE UP
			if (inp < 8) {
				if (prevrow > 32) {
					row = row + 32;
				} else if (prevrow > 24) {
					row = row + 24;
				} else if (prevrow > 16) {
					row = row + 16;
				} else if (prevrow > 8) {
					row = row + 8;
				}
			} else {
				if (sib > 7) {
					inp = inp - 8;
					row = row + 1;
				}
			}
			$('.body-row').eq(row - 1).find('.clefs').children().eq(inp).children('input[type=text]').focus();
		}
		if (e.keyCode == 40) {    //MOVE DOWN
			if (sib > 31) {
				if (inp > 31) {
					inp = inp - 32;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			} else if (sib > 23) {
				if (inp > 23) {
					inp = inp - 24;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			} else if (sib > 15) {
				if (inp > 15) {
					inp = inp - 16;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			} else if (sib > 7) {
				if (inp > 7) {
					inp = inp - 8;
				} else {
					row = row - 1;
					inp = inp + 8;
				}
			}
			$('.body-row').eq(row + 1).find('.clefs').children().eq(inp).children('input[type=text]').focus();
		}
	}
    }
);
