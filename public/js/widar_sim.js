const canvas = document.getElementById('sim');
const sim_settings = document.getElementById('sim_settings');
const sim_frame = document.getElementById('sim_frame');

function sim_home() {
 // recenter the simulation to the origin
}

document.onfullscreenchange = () => {
    sim_frame.classList.toggle('fullscreen');
}

function sim_toggle_settings() {
    sim_settings.classList.toggle('hidden');
}

function sim_toggle_fullscreen(elem)
{
    if (document.fullscreenElement) {
        document.exitFullscreen()
        elem.classList.toggle('smallscreen fullscreen');
    } else {
        sim_frame.requestFullscreen();
        elem.classList.replace('fullscreen', 'smallscreen');

    }
}


(function(){

})();