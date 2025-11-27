<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Heather Rosenau | CAD Designer</title>
  <!-- Google Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Orbitron:wght@400;700&display=swap" rel="stylesheet">
  <style>
    /* Global and background */
body {
  font-family: 'Montserrat', sans-serif;
  background-color: #0a2a43; /* blueprint blue */
  background-image:
    linear-gradient(135deg, rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(45deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  color: #fdfdfd;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  margin: 0;
}

/* Card */
.card {
  position: relative;
  background: #2c3e50; /* steel gray */
  border: 2px solid #00bcd4; /* cyan accent border */
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.4);
  padding: 40px;
  text-align: center;
  max-width: 700px;
  overflow: hidden;
  animation: float 4s ease-in-out infinite; /* automatic hover effect */
}

@keyframes float {
  0% { transform: translateY(0px); }
  50% { transform: translateY(-8px); }
  100% { transform: translateY(0px); }
}

/* Profile picture and CAD-style frame */
.profile-wrapper {
  position: relative;
  display: inline-block;
  margin: 0 auto 20px auto; /* centered above text on mobile */
}
.profile-pic {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  border: 3px solid #00bcd4;
  display: block;
  transition: box-shadow 0.3s ease;
}
.profile-pic:hover {
  box-shadow: 0 0 15px rgba(0,188,212,0.7);
}
.profile-wrapper::before,
.profile-wrapper::after {
  content: "";
  position: absolute;
  width: 30px;
  height: 30px;
  border: 2px solid rgba(0,188,212,0.4);
}
.profile-wrapper::before {
  top: -10px;
  left: -10px;
  border-right: none;
  border-bottom: none;
}
.profile-wrapper::after {
  bottom: -10px;
  right: -10px;
  border-left: none;
  border-top: none;
}

/* Typography */
.card h1 {
  margin: 0 0 10px 0;
  font-size: 2em;
  font-family: 'Orbitron', sans-serif;
  font-weight: 700;
  color: #00bcd4;
}
.card p {
  margin: 8px 0 20px 0;
  font-size: 1.1em;
  color: #fdfdfd;
}

/* Navigation buttons: centered and evenly spaced */
.contact {
  display: flex;
  justify-content: center;  /* center row */
  align-items: center;
  flex-wrap: wrap;          /* wrap on small screens */
  gap: 12px;                /* even spacing between buttons */
  margin-top: 15px;
}
.contact a {
  flex: 0 1 auto;           /* natural sizing */
  display: inline-block;
  padding: 10px 20px;
  background: #00bcd4;
  color: #0a2a43;
  text-decoration: none;
  border-radius: 5px;
  font-size: 0.9em;
  cursor: pointer;
  transition: background 0.3s, transform 0.2s;
}
.contact a:hover {
  background: #0097a7;
  transform: scale(1.05);
}
.contact a.active {
  background: #9b59b6;
  color: #fff;
}

/* Expandable sections */
.hidden-section {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.5s ease-out, opacity 0.5s ease-out;
  margin-top: 20px;
  text-align: left;
  opacity: 0;
}
.hidden-section.open {
  max-height: 1000px;
  opacity: 1;
  transition: max-height 0.5s ease-in, opacity 0.5s ease-in;
}
.hidden-section h2 {
  font-size: 1.2em;
  color: #00bcd4;
  font-family: 'Orbitron', sans-serif;
}
.hidden-section p, .hidden-section ul {
  color: #fdfdfd;
}

/* Portfolio gallery */
.gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.gallery img {
  width: 100px;
  height: 100px;
  object-fit: cover;
  border: 2px solid #00bcd4;
  border-radius: 5px;
  cursor: pointer;
  transition: transform 0.3s;
}
.gallery img:hover {
  transform: scale(1.1);
}
.expanded-img {
  margin-top: 15px;
  text-align: center;
}
.expanded-img img {
  max-width: 100%;
  border: 3px solid #9b59b6;
  border-radius: 8px;
}

/* Lightbox overlay with arrows */
#lightbox {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(10,42,67,0.8);
  backdrop-filter: blur(6px);
  display: none;                 /* hidden by default */
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
#lightbox-content {
  position: relative;
  text-align: center;
}
#lightbox img {
  max-width: 80%;
  max-height: 80%;
  border: 4px solid #00bcd4;
  border-radius: 10px;
  box-shadow: 0 0 25px rgba(0,188,212,0.7);
}
#lightbox p {
  margin-top: 15px;
  color: #fdfdfd;
  font-style: italic;
}
/* Arrows */
.arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 2em;
  color: #00bcd4;
  cursor: pointer;
  user-select: none;
}
.arrow:hover {
  color: #9b59b6;
}
#arrow-left { left: -60px; }
#arrow-right { right: -60px; }

/* Divider (desktop only) and responsive layout */
@media (min-width: 768px) {
  .card {
    display: flex;
    align-items: flex-start;
    text-align: left;
  }
  .profile-wrapper {
    margin: 0 30px 0 0;   /* picture on the left with spacing */
  }
  .card-content {
    flex: 1;
    padding-left: 30px;   /* breathing room next to divider */
  }
  .divider {
    width: 2px;
    background: rgba(0,188,212,0.4);
    margin: 0 20px;
  }
}
  </style>
</head>
<body>
   <!-- Lightbox overlay -->
<div id="lightbox" onclick="closeLightbox(event)">
  <div id="lightbox-content">
    <span id="arrow-left" class="arrow" onclick="prevImage(event)">&#10094;</span>
    <img id="lightbox-img" src="" alt="">
    <span id="arrow-right" class="arrow" onclick="nextImage(event)">&#10095;</span>
    <p id="lightbox-caption"></p>
  </div>
</div>

  <div class="card">
    <!-- Profile picture with CAD frame -->
    <div class="profile-wrapper">
      <img src="profile.jpg" alt="Heather Rosenau" class="profile-pic">
    </div>

    <!-- Divider (desktop only) -->
    <div class="divider"></div>

    <!-- Text content -->
    <div class="card-content">
      <h1>Heather Rosenau</h1>
      <p>CAD Designer</p>
      <hr>
      <div class="contact">
  <a href="https://linkedin.com/in/heatherrosenau">LinkedIn</a>
  <a id="projectsBtn" onclick="toggleSection('projects', 'projectsBtn')">Projects</a>
  <a id="aboutBtn" onclick="toggleSection('about', 'aboutBtn')">More About Me</a>
  <a id="contactBtn" onclick="toggleSection('contact', 'contactBtn')">Contact</a>
</div>

      <!-- Hidden Projects section with gallery -->
      <div id="projects" class="hidden-section">
        <h2>Projects</h2>
        <div class="gallery">
          <img src="project1.jpg" alt="Project 1" onclick="expandImage(this)">
          <img src="project2.jpg" alt="Project 2" onclick="expandImage(this)">
          <img src="project3.jpg" alt="Project 3" onclick="expandImage(this)">
          <img src="project4.jpg" alt="Project 4" onclick="expandImage(this)">
        </div>
        <div id="expanded" class="expanded-img"></div>
      </div>

      <!-- Hidden About section -->
      <div id="about" class="hidden-section">
        <h2>About Heather</h2>
        <p>Heather Rosenau is a CAD designer passionate about precision and creativity. 
           With years of experience in 2D drafting and 3D modeling, she helps engineers, 
           architects, and product teams bring their ideas to life with accuracy and innovation.</p>
      </div>
      <!-- Hidden Contact section -->
<div id="contact" class="hidden-section">
  <h2>Contact Heather</h2>
  <p>You can reach Heather through the following channels:</p>
  <ul>
    <li>Email: <a href="mailto:heather.rosenau@example.com">heather.rosenau@example.com</a></li>
    <li>Phone: (555) 123‑4567</li>
    <li>LinkedIn: <a href="https://linkedin.com/in/heatherrosenau">linkedin.com/in/heatherrosenau</a></li>
  </ul>
</div>
    </div>
  </div>

 <script>
  let currentIndex = 0;
  let galleryImages = [];

  function toggleSection(sectionId, btnId) {
    const sections = document.querySelectorAll('.hidden-section');
    const buttons = document.querySelectorAll('.contact a');

    sections.forEach(sec => sec.classList.remove('open'));
    buttons.forEach(btn => btn.classList.remove('active'));

    const section = document.getElementById(sectionId);
    const button = document.getElementById(btnId);

    if (!section.classList.contains('open')) {
      section.classList.add('open');
      button.classList.add('active');
    }
  }

  function expandImage(img) {
    galleryImages = Array.from(document.querySelectorAll('.gallery img'));
    currentIndex = galleryImages.indexOf(img);

    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');

    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = img.alt;

    lightbox.style.display = 'flex';
  }

  function closeLightbox(event) {
    if (event && (event.target.classList.contains('arrow') || event.target.id === 'lightbox-img')) return;
    document.getElementById('lightbox').style.display = 'none';
  }

  function prevImage(event) {
    if (event) event.stopPropagation();
    currentIndex = (currentIndex - 1 + galleryImages.length) % galleryImages.length;
    showImage();
  }

  function nextImage(event) {
    if (event) event.stopPropagation();
    currentIndex = (currentIndex + 1) % galleryImages.length;
    showImage();
  }

  function showImage() {
    const img = galleryImages[currentIndex];
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');

    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = img.alt;
  }

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    const lightbox = document.getElementById('lightbox');
    if (lightbox.style.display === 'flex') {
      if (e.key === 'ArrowLeft') {
        prevImage();
      } else if (e.key === 'ArrowRight') {
        nextImage();
      } else if (e.key === 'Escape') {
        closeLightbox();
      }
    }
  });
</script>
</body>
</html>
