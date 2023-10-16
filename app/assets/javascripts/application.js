// This is a manifest file that'll be compiled into application.js, which will include all the files
// listed below.
//
// Any JavaScript/Coffee file within this directory, lib/assets/javascripts, vendor/assets/javascripts,
// or any plugin's vendor/assets/javascripts directory can be referenced here using a relative path.
//
// It's not advisable to add code directly here, but if you do, it'll appear at the bottom of the
// compiled file. JavaScript code in this file should be added after the last require_* statement.
//
// Read Sprockets README (https://github.com/rails/sprockets#sprockets-directives) for details
// about supported directives.
//
//= require jquery
//= require jquery_ujs
//= require_tree .


// Autofill composers with values in first inclusion row
$( document ).ready(function(){
	$('.autofill-composers').click(function(){
		$('ul.composer li:first-child input').val($('ul.composer:first-of-type li:first-child input').val());
		$('ul.composer li:first-child select').val($('ul.composer:first-of-type li:first-child select').val());
	})
	$('.autofill-language').click(function(){
		console.log($('div.inclusion div.language select:first-of-type').val());
		$('div.inclusion div.language select').val($('div.inclusion div.language select:first-of-type').val());
	})
	$('.autofill-composition-type').click(function(){
		console.log($('div.inclusion div.type select:first-of-type').val());
		$('div.inclusion div.type select').val($('div.inclusion div.type select:first-of-type').val());
	})
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

// Use arrow keys to move around inputs in source editor
$(document).keydown(
    function(e)
    {    
	    var mov = $(':focus').index();
	    var sib = $(':focus').siblings('input').length;
	    var par = $(':focus').closest('.body-row').index('.body-row');
	    var prevpar = $('.body-row').eq(par - 1).find('.clefs').children('input').length;
		if ($(':focus').parent().hasClass('clefs')) {
			if (e.keyCode == 38) {  //MOVE UP
				if (mov < 8) {
					if (prevpar > 32) {
						mov = mov + 32;
					} else if (prevpar > 24) {
						mov = mov + 24;
					} else if (prevpar > 16) {
						mov = mov + 16;
					} else if (prevpar > 8) {
						mov = mov + 8;
					}
				} else {
					if (sib > 7) {
						mov = mov - 8;
						par = par + 1;
					}
				}
				$('.body-row').eq(par - 1).find('.clefs').children().eq(mov).focus();
			}
			if (e.keyCode == 40) {    //MOVE DOWN
				if (sib > 31) {
					if (mov > 31) {
						mov = mov - 32;
					} else {
						par = par - 1;
						mov = mov + 8;					
					}
				} else if (sib > 23) {
					if (mov > 23) {
						mov = mov - 24;
					} else {
						par = par - 1;
						mov = mov + 8;					
					}
				} else if (sib > 15) {
					if (mov > 15) {
						mov = mov - 16;
					} else {
						par = par - 1;
						mov = mov + 8;					
					}
				} else if (sib > 7) {
					if (mov > 7) {
						mov = mov - 8;
					} else {
						par = par - 1;
						mov = mov + 8;					
					}
				}
				$('.body-row').eq(par + 1).find('.clefs').children().eq(mov).focus();
			}
		} else if ($(':focus').parent().hasClass('title')) {
			if (e.keyCode == 38) {  //MOVE UP
				$('.body-row').eq(par - 1).find('.title').children('textarea').focus();
			}
			if (e.keyCode == 40) {  //MOVE DOWN
				$('.body-row').eq(par + 1).find('.title').children('textarea').focus();
			}
		} else if ($(':focus').parent().hasClass('notes')) {
			if (e.keyCode == 38) {  //MOVE UP
				$('.body-row').eq(par - 1).find('.notes').children('textarea').focus();
			}
			if (e.keyCode == 40) {  //MOVE DOWN
				$('.body-row').eq(par + 1).find('.notes').children('textarea').focus();
			}
		}
    }
);
