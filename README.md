<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Merriweather:wght@400;700&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
  <title>Jordan Dudgeon – Portfolio</title>
  <style>
    /* ---------------------------------- */
    /* GLOBAL STYLES & BOOKISH (DEFAULT) THEME */
    /* ---------------------------------- */

    body {
      margin: 0;
      font-family: 'Georgia', serif;
      transition: background 0.5s;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      /* Default Bookish Theme Colors */
      background: #fdf6e3; 
    }

    main { flex: 1; }

    /* Floating Card Animation */
    @keyframes float {
      0%, 100% { transform: translateY(0); box-shadow: 0 8px 16px rgba(0,0,0,0.25); }
      50% { transform: translateY(-5px); box-shadow: 0 12px 24px rgba(0,0,0,0.35); }
    }

    /* Card Layout & Base Styles */
    .card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      border-radius: 8px;
      padding: 30px 20px; 
      width: 90%;
      max-width: 550px; 
      margin: 40px auto;
      box-shadow: 0 8px 16px rgba(0,0,0,0.25);
      animation: float 3s ease-in-out infinite;
      /* Bookish Colors */
      background: #fff; 
      color: #4b2e2e;
    }

    .profile-pic img {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      border: 3px solid #8b5e3c;
      margin-bottom: 20px;
      object-fit: cover; 
    }

    .divider { display: none; }

    .info { text-align: center; }
    .info h1 { margin: 0; font-size: 1.8em; color: #4b2e2e; text-transform: uppercase; }
    .info h2 { margin: 5px 0 15px; font-size: 1.2em; color: #6b4226; font-family: 'Courier New', monospace; }
    .info p { font-size: 1em; margin: 15px 0; color: #3e2c1c; line-height: 1.5; }

    .info a, .info button {
      display: inline-block;
      margin: 8px 10px; 
      padding: 10px 16px; 
      border-radius: 4px;
      font-family: 'Georgia', serif;
      text-decoration: none; 
      background: #6b4226;
      color: #fff;
      border: none;
      cursor: pointer;
      transition: background 0.3s, transform 0.1s;
    }
    .info a:hover, .info button:hover { background: #4b2e2e; transform: translateY(-2px); }

    /* Theme Switch Button Position */
    .toggle-theme-btn-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 100; 
    }
    .toggle-theme-btn-container .toggle-btn {
      padding: 8px 15px;
      font-weight: bold;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      background: #6b4226;
      color: #fff;
    }


    /* Projects Section (Accordion) */
    .projects {
      width: 90%;
      max-width: 800px;
      margin: 20px auto; 
      padding: 20px;
      border-radius: 8px;
      border: 3px solid #8b5e3c;
      box-shadow: 0 8px 16px rgba(0,0,0,0.25);
      background: #fff8dc;
      
      opacity: 0;
      max-height: 0;
      overflow: hidden;
      transition: opacity 0.3s ease, max-height 0.3s ease;
    }
    .projects.show {
      opacity: 1;
      max-height: 2000px; 
    }

    .projects h2 {
      text-align: center;
      font-size: 1.6em;
      margin-bottom: 20px;
      color: #4b2e2e;
      text-transform: uppercase;
    }

    .project-item {
      margin-bottom: 20px;
      padding: 15px;
      border-bottom: 1px dashed #8b5e3c;
      cursor: pointer; 
      transition: background-color 0.2s;
    }
    .project-item:hover {
      background-color: #f0eadc; 
    }
    .project-item:last-child { border-bottom: none; }
    .project-item h3 { margin: 0; font-size: 1.3em; color: #6b4226; }
    .project-item p { margin: 5px 0 0; font-size: 1em; color: #3e2c1c; }


    /* ---------------------------------- */
    /* MODAL STYLES (General) */
    /* ---------------------------------- */

    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.75); 
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
      backdrop-filter: blur(2px);
    }

    .modal-backdrop.show {
      display: block;
      opacity: 1;
    }

    .modal-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      width: 90%;
      max-width: 450px; 
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 15px 30px rgba(0, 0, 0, 0.5);
      
      background: #fff8dc; 
      border: 3px solid #8b5e3c;
      color: #3e2c1c;

      transition: transform 0.3s ease;
    }

    .modal-backdrop.show .modal-content {
      transform: translate(-50%, -50%) scale(1);
    }
    
    .modal-content h2 {
      text-align: center;
      font-size: 1.6em;
      margin-bottom: 25px;
      color: #4b2e2e;
      text-transform: uppercase;
    }
    
    .modal-content p { margin: 10px 0; }
    .modal-content strong { color: #4b2e2e; }
    
    .modal-contact-row {
      display: flex;
      gap: 15px;
      justify-content: center;
      margin-top: 30px;
    }

    .modal-close-btn {
      position: absolute;
      top: 10px;
      right: 15px;
      background: none;
      border: none;
      font-size: 1.5em;
      font-weight: bold;
      cursor: pointer;
      color: #4b2e2e;
      transition: color 0.2s;
    }
    .modal-close-btn:hover { color: #6b4226; }


    /* ---------------------------------- */
    /* PROJECTS GALLERY MODAL STYLES (Adjusted) */
    /* ---------------------------------- */

    /* Wider content for the gallery view */
    .project-modal-content {
        max-width: 700px; 
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        padding: 30px 10px; 
        min-height: 250px; 
    }

    /* New: Media Container */
    .project-media-container {
        width: 100%;
        max-height: 300px; 
        overflow: hidden; 
        margin-bottom: 20px;
        display: flex; 
        justify-content: center;
        align-items: center;
        background-color: rgba(0,0,0,0.1); 
        border-radius: 4px;
    }

    .project-media-container img,
    .project-media-container iframe {
        max-width: 100%;
        max-height: 100%;
        display: block; 
        object-fit: contain; 
        border-radius: 4px;
    }

    /* Project Details Content & Transition */
    .project-details {
        flex-grow: 1; 
        text-align: center;
        padding: 0 20px; 
        /* NEW: Transition Property */
        transition: opacity 0.15s ease-in-out; 
    }

    /* NEW: Fade Classes */
    .project-details.fade-out { opacity: 0; }
    .project-details.fade-in { opacity: 1; }
    /* End Fade Classes */


    .project-details .info-link {
        display: inline-block; 
        margin-top: 25px;
        padding: 10px 16px; 
        border-radius: 4px;
        font-family: 'Georgia', serif;
        text-decoration: none; 
        background: #6b4226; 
        color: #fff;
        border: none;
        transition: background 0.3s;
    }
    .project-details .info-link:hover {
        background: #4b2e2e;
    }

    /* Navigation Arrows (Positioned absolutely within the modal-content) */
    .project-modal-content .nav-btn { 
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255,255,255,0.7); 
      border-radius: 50%;
      width: 40px;
      height: 40px;
      display: flex;
      justify-content: center;
      align-items: center;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    }

    .project-modal-content .nav-btn.left-btn { left: 5px; }
    .project-modal-content .nav-btn.right-btn { right: 5px; }

    .nav-btn {
        font-size: 2.5em;
        font-weight: bold;
        color: #4b2e2e; 
        cursor: pointer;
        padding: 0; 
        transition: color 0.2s, background 0.2s, transform 0.1s;
        user-select: none;
        line-height: 1; 
    }
    .nav-btn:hover {
        color: #6b4226;
        background: rgba(255,255,255,0.9);
        transform: translateY(-50%) scale(1.1); 
    }

    /* Footer */
    footer {
      padding: 15px;
      font-size: 0.9em;
      background: #6b4226;
      color: #fff;
      text-align: center;
      margin-top: auto; 
    }
    footer .toggle-btn { display: none; }

    /* Desktop Layout (min-width: 700px) */
    @media (min-width: 700px) {
      .card {
        flex-direction: row;
        align-items: flex-start;
        text-align: left;
        max-width: 900px;
      }
      .profile-pic { margin-right: 30px; }
      .divider {
        display: block;
        width: 2px;
        background-color: #8b5e3c; 
        margin-right: 30px;
        align-self: stretch;
      }
      .info { flex: 1; text-align: left; }
      .info a, .info button { margin-left: 0; }
    }
    
    /* NEW: Mobile Refinements (for very narrow screens) */
    @media (max-width: 450px) {
        /* Force main card buttons to stack vertically and take full width */
        .info a, .info button {
            display: block; 
            width: 90%;     
            margin: 8px auto; 
            text-align: center;
        }
    }


    /* ---------------------------------- */
    /* THEME STYLING OVERRIDES */
    /* ---------------------------------- */

    /* Dungeon Theme Nav */
    .dungeon .nav-btn { color: #f0e6f6; background: rgba(0,0,0,0.5); } 
    .dungeon .nav-btn:hover { color: #C47A83; background: rgba(0,0,0,0.7); }
    .dungeon .project-details .info-link { background: #6b0f1a; color: #f0e6f6; }
    .dungeon .project-details .info-link:hover { background: #a3152c; }

    /* Seasonal Theme Nav */
    .seasonal .nav-btn { color: #8b4513; background: rgba(255,255,255,0.7); }
    .seasonal .nav-btn:hover { color: #cc6633; background: rgba(255,255,255,0.9); }
    .seasonal .project-details .info-link { background: #d2691e; color: #fffaf0; }
    .seasonal .project-details .info-link:hover { background: #a0522d; }

    /* Dungeon Theme */
    body.dungeon { background: #1a1a1a; }
    .dungeon .card { background: #2b1b1b; border: 3px solid #6b0f1a; }
    .dungeon .profile-pic img { border-color: #6b0f1a; }
    .dungeon .divider { background-color: #6b0f1a; }
    .dungeon .info h1 { color: #f0e6f6; font-family: 'Cinzel', serif; }
    .dungeon .info h2 { color: #C47A83; } 
    .dungeon .info p { color: #e0d0e6; }
    .dungeon .info a, .dungeon .info button { background: #6b0f1a; color: #f0e6f6; }
    .dungeon .info a:hover, .dungeon .info button:hover { background: #a3152c; }
    .dungeon .projects { background: #2b1b1b; border: 3px solid #6b0f1a; } 
    .dungeon .projects h2, .dungeon .modal-content h2 { color: #f0e6f6; }
    .dungeon .project-item h3 { color: #C47A83; } 
    .dungeon .project-item p { color: #e0d0e6; }
    .dungeon .project-item:hover { background-color: #3e2c2c; } 
    .dungeon .modal-content { background: #2b1b1b; border: 3px solid #6b0f1a; } 
    .dungeon .modal-content strong { color: #C47A83; } 
    .dungeon footer { background: #6b0f1a; color: #f0e6f6; }
    .dungeon .toggle-theme-btn-container .toggle-btn { background: #f0e6f6; color: #6b0f1a; }
    .dungeon .modal-close-btn { color: #f0e6f6; }
    .dungeon .modal-close-btn:hover { color: #C47A83; }

    /* Seasonal Theme */
    body.seasonal {
      background: linear-gradient(to bottom, #fff3e0, #ffe0b2); 
    }
    .seasonal .card {
      background: #fffaf0;
      border: 3px solid #d2691e; 
    }
    .seasonal .profile-pic img {
      border-color: #d2691e;
    }
    .seasonal .divider { background-color: #d2691e; }
    .seasonal .info h1 {
      color: #8b4513;
      font-family: 'Merriweather', serif;
    }
    .seasonal .info h2 { color: #cc6633; }
    .seasonal .info p { color: #5c4033; }
    .seasonal .info a, .seasonal .info button {
      background: #d2691e;
      color: #fffaf0;
    }
    .seasonal .info a:hover, .seasonal .info button:hover {
      background: #a0522d;
    }
    .seasonal .projects { background: #fffaf0; border: 3px solid #d2691e; } 
    .seasonal .projects h2, .seasonal .modal-content h2 {
      color: #8b4513;
    }
    .seasonal .project-item h3 { color: #cc6633; }
    .seasonal .project-item p {
      color: #5c4033;
    }
    .seasonal .project-item:hover { background-color: #ffecc6; } 
    .seasonal .modal-content { background: #fffaf0; border: 3px solid #d2691e; } 
    .seasonal .modal-content strong { color: #cc6633; }
    .seasonal footer {
      background: #d2691e;
      color: #fffaf0;
    }
    .seasonal .toggle-theme-btn-container .toggle-btn { background: #fffaf0; color: #d2691e; }
    .seasonal .modal-close-btn { color: #8b4513; }
    .seasonal .modal-close-btn:hover { color: #d2691e; }

  </style>
</head>
<body class="bookish">
  <div class="toggle-theme-btn-container">
    <button class="toggle-btn" onclick="toggleTheme()" aria-label="Switch between Bookish, Dungeon, and Seasonal Themes">Switch Theme</button>
  </div>
  
  <main>
    <div class="card">
      <div class="profile-pic">
        <img src="https://via.placeholder.com/120/8b5e3c/ffffff?text=JD" alt="Jordan Dudgeon Profile Picture" />
      </div>
      <div class="divider"></div>
      <div class="info">
        <h1>Jordan Dudgeon</h1>
        <h2>Business Systems & Customer Success Specialist</h2>
        <p>Experienced customer service and inventory specialist with a background in logistics, sales, and software support. Passionate about teamwork, adaptability, and continuous growth in dynamic environments. **Ready for my next role at Intrepid Potash.**</p>

        <a href="https://www.linkedin.com/in/jordan-dudgeon" target="_blank" aria-label="Connect with me on LinkedIn">LinkedIn</a>
        <button onclick="toggleSection('projects')" aria-expanded="false" aria-controls="projects">Projects</button>
        <button onclick="openModal('contactModal')">Contact Me</button>
      </div>
    </div>

    <div class="projects" id="projects" role="region" aria-labelledby="projects-heading">
      <h2 id="projects-heading">Projects</h2>
      <div class="project-item" onclick="openProjectGallery(0)">
        <h3>Dynamic Themed Portfolio</h3>
        <p>A personal branding site with dynamic design, three aesthetic themes, and smooth content transitions.</p>
      </div>
      <div class="project-item" onclick="openProjectGallery(1)">
        <h3>Inter-Departmental Project Analysis</h3>
        <p>A comprehensive analysis for an internal stakeholder, focused on system integration and workflow optimization.</p>
      </div>
      <div class="project-item" onclick="openProjectGallery(2)">
        <h3>Future Systems Initiatives</h3>
        <p>Seeking roles focused on system implementation, process optimization, and operational efficiency.</p>
      </div>
    </div>
    
  </main>

  <div class="modal-backdrop" id="contactModal" onclick="closeModal('contactModal')">
    <div class="modal-content" onclick="event.stopPropagation()">
      <button class="modal-close-btn" onclick="closeModal('contactModal')" aria-label="Close Contact Window">&times;</button>
      <h2>Contact Me</h2>
      <p>I am currently transitioning to a new role but welcome professional inquiries. You can reach me directly at:</p>
      <p><strong>Email:</strong> jdudgeon1993@gmail.com</p>
      <p><strong>Phone:</strong> 720.220.9553</p>
      <div class="modal-contact-row">
        <a href="https://www.linkedin.com/in/jordan-dudgeon" target="_blank">LinkedIn</a>
        <a href="mailto:jdudgeon1993@gmail.com">Send an email</a>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="projectModal" onclick="closeModal('projectModal')">
      <div class="modal-content project-modal-content" onclick="event.stopPropagation()">
          <button class="modal-close-btn" onclick="closeModal('projectModal')" aria-label="Close Project Gallery">&times;</button>
          
          <button class="nav-btn left-btn" onclick="navigateProjects(-1)" aria-label="Previous Project">&lt;</button>
          
          <div class="project-details fade-out"> 
              <div class="project-media-container">
              </div>
              <h2 id="project-title"></h2>
              <p id="project-description"></p>
              <a id="project-link" href="#" target="_blank" class="info-link">View Project / Code</a>
          </div>

          <button class="nav-btn right-btn" onclick="navigateProjects(1)" aria-label="Next Project">&gt;</button>
      </div>
  </div>


  <footer>
    <div class="footer-content">
      <p>&copy; 2025 Jordan Dudgeon | All Rights Reserved.</p>
    </div>
  </footer>

  <script>
    // ----------------------------------
    // PROJECT DATA ARRAY (All three projects finalized)
    // ----------------------------------
    const projectsData = [
        { 
            title: "Dynamic Themed Portfolio", 
            description: "Designed and developed a responsive, single-page professional portfolio using vanilla HTML, CSS, and JavaScript. Key features include a floating 'business card' layout, three distinct CSS-driven aesthetic themes (Bookish, Dungeon, Seasonal), and smooth content transitions, showcasing proficiency in front-end development and thematic design.",
            link: "https://github.com/jdudgeon1993/Projects.git", 
            mediaUrl: "https://via.placeholder.com/600x400/8b5e3c/ffffff?text=Portfolio+Live+View" 
        },
        { 
            title: "Inter-Departmental Project Analysis", 
            description: "Executed a comprehensive analysis for an internal stakeholder, providing actionable recommendations on system integration, workflow optimization, and team resource allocation. This project showcases strong research, problem-solving, and professional communication skills used to drive measurable operational improvements.",
            link: "https://github.com/jdudgeon1993/Projects/blob/28454ac426544536ed555853b532563bf96f52a3/Heathers%20Project", 
            mediaUrl: "https://via.placeholder.com/600x400/6b4226/ffffff?text=Project+Report+Analysis" 
        },
        { 
            title: "Future Systems Initiatives", 
            description: "Dedicated to continuous skill application in the Business Systems space. Currently seeking roles focused on system implementation, process optimization, and operational efficiency. Ready to apply expertise in logistics, data analysis, and technical problem-solving to new challenges.",
            link: "https://www.linkedin.com/in/jordan-dudgeon", 
            mediaUrl: "https://via.placeholder.com/600x400/4b2e2e/ffffff?text=Ready+For+Next+Role" 
        }
    ];

    let currentProjectIndex = 0; 
    
    // ----------------------------------
    // GENERAL MODAL & THEME FUNCTIONS
    // ----------------------------------
    
    function toggleTheme() {
      const body = document.body;
      const themes = ['bookish', 'dungeon', 'seasonal'];
      let currentTheme = themes.find(t => body.classList.contains(t));
      
      let nextIndex = (themes.indexOf(currentTheme) + 1) % themes.length;
      let nextTheme = themes[nextIndex];

      body.className = nextTheme;
      
      const contactModal = document.getElementById('contactModal');
      const projectModal = document.getElementById('projectModal');
      // If either modal is open, keep body overflow hidden
      if (contactModal.classList.contains('show') || projectModal.classList.contains('show')) {
        body.style.overflow = 'hidden';
      }
    }

    // Projects Accordion Toggle 
    function toggleSection(id) {
      const section = document.getElementById(id);
      const button = document.querySelector(`button[aria-controls="${id}"]`);

      // Close Contact Modal if Projects accordion is opened
      closeModal('contactModal');
      
      const isShowing = section.classList.toggle('show');
      
      button.setAttribute('aria-expanded', isShowing);

      if (isShowing) {
        setTimeout(() => {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    }

    // Generic function to open ANY modal
    function openModal(id) {
        // Close Projects Accordion 
        const projectsAccordion = document.getElementById('projects');
        if (projectsAccordion.classList.contains('show')) {
            projectsAccordion.classList.remove('show');
            document.querySelector('button[aria-controls="projects"]').setAttribute('aria-expanded', false);
        }
        
        // Close Project Gallery Modal 
        closeModal('projectModal');

        const modal = document.getElementById(id);
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    // Generic function to close ANY modal
    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('show');
        }
        // Only re-enable scrolling if no modals are open
        const contactModalOpen = document.getElementById('contactModal').classList.contains('show');
        const projectModalOpen = document.getElementById('projectModal').classList.contains('show');
        
        if (!contactModalOpen && !projectModalOpen) {
             document.body.style.overflow = 'auto';
        }
    }

    // ----------------------------------
    // PROJECT GALLERY MODAL FUNCTIONS (Updated with Media and Fade Logic)
    // ----------------------------------
    
    function renderProject(index) {
        const detailsContainer = document.querySelector('.project-details');
        
        // Step 1: Apply fade-out
        detailsContainer.classList.remove('fade-in');
        detailsContainer.classList.add('fade-out');

        // Wait for the fade-out duration (150ms) before updating content
        setTimeout(() => {
            // Handle wrapping around the project array
            if (index >= projectsData.length) {
                index = 0;
            } else if (index < 0) {
                index = projectsData.length - 1;
            }
            
            currentProjectIndex = index;
            const project = projectsData[index];
            
            // --- CONTENT UPDATE ---
            document.getElementById('project-title').textContent = project.title;
            document.getElementById('project-description').textContent = project.description;
            
            const linkElement = document.getElementById('project-link');
            linkElement.href = project.link;

            if (project.link.toLowerCase().includes("code") || project.link.toLowerCase().includes("github")) {
                linkElement.textContent = "View Code";
            } else if (project.link.toLowerCase().includes("document") || project.link.toLowerCase().includes("dropbox")) {
                linkElement.textContent = "View Document";
            } else {
                linkElement.textContent = "View Project";
            }

            // --- MEDIA UPDATE ---
            const mediaContainer = document.querySelector('.project-media-container');
            mediaContainer.innerHTML = ''; 

            if (project.mediaUrl) {
                if (project.mediaUrl.includes('youtube.com') || project.mediaUrl.includes('vimeo.com')) {
                    const iframe = document.createElement('iframe');
                    iframe.src = project.mediaUrl;
                    iframe.setAttribute('frameborder', '0');
                    iframe.setAttribute('allowfullscreen', '');
                    iframe.style.width = '100%';
                    iframe.style.height = '300px'; 
                    mediaContainer.appendChild(iframe);
                } else {
                    const img = document.createElement('img');
                    img.src = project.mediaUrl;
                    img.alt = project.title + " screenshot";
                    mediaContainer.appendChild(img);
                }
            }
            
            // Step 3: Apply fade-in
            detailsContainer.classList.remove('fade-out');
            detailsContainer.classList.add('fade-in');

        }, 150); // Wait 150 milliseconds
    }

    function navigateProjects(direction) {
        renderProject(currentProjectIndex + direction);
    }

    // Function to open the project modal
    function openProjectGallery(startIndex = 0) {
        const modal = document.getElementById('projectModal');
        
        // Mutual Exclusivity: Close the Contact Modal
        closeModal('contactModal'); 

        renderProject(startIndex); // Load the clicked project's content
        
        // Ensure the initial content is visible after rendering
        document.querySelector('.project-details').classList.add('fade-in');

        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    // ----------------------------------
    // A11Y: Keyboard Event Listener (NEW!)
    // ----------------------------------
    document.addEventListener('keydown', function(event) {
        const projectModal = document.getElementById('projectModal');
        const contactModal = document.getElementById('contactModal');

        // 1. Escape Key: Closes any open modal
        if (event.key === 'Escape') {
            if (projectModal.classList.contains('show')) {
                closeModal('projectModal');
            } else if (contactModal.classList.contains('show')) {
                closeModal('contactModal');
            }
        }

        // 2. Arrow Keys: Navigates projects only if projectModal is open
        if (projectModal.classList.contains('show')) {
            if (event.key === 'ArrowRight') {
                navigateProjects(1);
            } else if (event.key === 'ArrowLeft') {
                navigateProjects(-1);
            }
        }
    });

  </script>
</body>
</html>
