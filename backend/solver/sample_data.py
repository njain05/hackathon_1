"""A realistic sample engineering college, used for demos and tests."""

from .models import (
    Assignment,
    CollegeData,
    Department,
    Room,
    RoomType,
    Break,
    Section,
    Settings,
    Subject,
    Teacher,
)

# (code, name, dept, lecture hours, lab hours, lab room type or None)
_SUBJECTS = [
    # CSE, 3rd semester
    ("CS201", "Data Structures", "CSE", 3, 2, "computer_lab"),
    ("MA201", "Discrete Mathematics", "CSE", 4, 0, None),
    ("CS203", "Database Management Systems", "CSE", 3, 2, "computer_lab"),
    ("CS205", "Digital Electronics", "CSE", 3, 0, None),
    ("CS207", "Computer Organisation", "CSE", 3, 0, None),
    ("CS209", "Object Oriented Programming (Java)", "CSE", 2, 2, "computer_lab"),
    # CSE, 5th semester
    ("CS301", "Operating Systems", "CSE", 3, 2, "computer_lab"),
    ("CS303", "Computer Networks", "CSE", 3, 2, "computer_lab"),
    ("CS305", "Design and Analysis of Algorithms", "CSE", 4, 0, None),
    ("CS307", "Software Engineering", "CSE", 3, 0, None),
    ("CS309", "Machine Learning", "CSE", 3, 2, "computer_lab"),
    # ECE, 3rd semester
    ("EC201", "Signals and Systems", "ECE", 4, 0, None),
    ("EC203", "Analog Electronics", "ECE", 3, 2, "electronics_lab"),
    ("EC205", "Network Analysis", "ECE", 3, 0, None),
    ("EC207", "Digital Electronics", "ECE", 3, 2, "electronics_lab"),
    ("MA203", "Engineering Mathematics III", "ECE", 4, 0, None),
    ("EC209", "Python Programming", "ECE", 2, 2, "computer_lab"),
    # ECE, 5th semester
    ("EC301", "Microprocessors", "ECE", 3, 2, "electronics_lab"),
    ("EC303", "Communication Systems", "ECE", 3, 2, "electronics_lab"),
    ("EC305", "Control Systems", "ECE", 4, 0, None),
    ("EC307", "VLSI Design", "ECE", 3, 0, None),
    ("EC309", "Antennas and Wave Propagation", "ECE", 3, 0, None),
]

_TEACHERS = [
    ("HK", "Dr. Harpreet Kaur", "CSE"),
    ("AS", "Prof. Amandeep Singh", "CSE"),
    ("NS", "Dr. Neha Sharma", "CSE"),
    ("RK", "Prof. Rajesh Kumar", "CSE"),
    ("SK", "Dr. Simranjeet Kaur", "CSE"),
    ("GS", "Prof. Gurpreet Singh", "CSE"),
    ("AV", "Dr. Anjali Verma", "CSE"),
    ("MG", "Prof. Manpreet Gill", "CSE"),
    ("PS", "Dr. Parminder Sandhu", "CSE"),
    ("BS", "Dr. Baljit Singh", "ECE"),
    ("RB", "Prof. Ritu Bansal", "ECE"),
    ("SS", "Dr. Sukhwinder Singh", "ECE"),
    ("KA", "Prof. Kavita Arora", "ECE"),
    ("VM", "Dr. Vikram Malhotra", "ECE"),
]

# section -> [(subject, teacher)]
_ASSIGNMENTS = {
    "CSE-3A": [
        ("CS201", "HK"), ("MA201", "PS"), ("CS203", "AS"),
        ("CS205", "RK"), ("CS207", "SK"), ("CS209", "GS"),
    ],
    "CSE-3B": [
        ("CS201", "HK"), ("MA201", "PS"), ("CS203", "NS"),
        ("CS205", "RK"), ("CS207", "SK"), ("CS209", "GS"),
    ],
    "CSE-5A": [
        ("CS301", "AV"), ("CS303", "MG"), ("CS305", "HK"),
        ("CS307", "RK"), ("CS309", "NS"),
    ],
    "ECE-3A": [
        ("EC201", "BS"), ("EC203", "RB"), ("EC205", "SS"),
        ("EC207", "KA"), ("MA203", "PS"), ("EC209", "AS"),
    ],
    "ECE-5A": [
        ("EC301", "VM"), ("EC303", "BS"), ("EC305", "SS"),
        ("EC307", "KA"), ("EC309", "RB"),
    ],
}


def sample_college() -> CollegeData:
    return CollegeData(
        name="Sample Institute of Engineering & Technology",
        settings=Settings(
            days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            periods_per_day=7,
            day_start="09:00",
            period_minutes=50,
            breaks=[
                Break(name="Tea break", after_period=2, minutes=10, labs_continue=True),
                Break(name="Lunch", after_period=4, minutes=40),
            ],
        ),
        room_types=[
            RoomType(id="classroom", name="Classroom", use="lecture"),
            RoomType(id="computer_lab", name="Computer lab", use="lab"),
            RoomType(id="electronics_lab", name="Electronics lab", use="lab"),
            RoomType(id="seminar_hall", name="Seminar hall", use="event"),
            RoomType(id="auditorium", name="Auditorium", use="event"),
        ],
        departments=[
            Department(id="CSE", name="Computer Science & Engineering"),
            Department(id="ECE", name="Electronics & Communication Engineering"),
        ],
        sections=[
            Section(id="CSE-3A", name="CSE 3rd Sem A", department_id="CSE", strength=60),
            Section(id="CSE-3B", name="CSE 3rd Sem B", department_id="CSE", strength=58),
            Section(id="CSE-5A", name="CSE 5th Sem A", department_id="CSE", strength=55),
            Section(id="ECE-3A", name="ECE 3rd Sem A", department_id="ECE", strength=60),
            Section(id="ECE-5A", name="ECE 5th Sem A", department_id="ECE", strength=48),
        ],
        subjects=[
            Subject(
                id=c, code=c, name=n, department_id=d,
                lecture_hours=lec, lab_hours=lab, lab_room_type=room_type,
            )
            for c, n, d, lec, lab, room_type in _SUBJECTS
        ],
        teachers=[Teacher(id=i, name=n, department_id=d) for i, n, d in _TEACHERS],
        assignments=[
            Assignment(section_id=sec, subject_id=sub, teacher_id=t)
            for sec, pairs in _ASSIGNMENTS.items()
            for sub, t in pairs
        ],
        rooms=[
            Room(id="C-101", name="Room C-101", type="classroom", capacity=65, department_id="CSE"),
            Room(id="C-102", name="Room C-102", type="classroom", capacity=65, department_id="CSE"),
            Room(id="C-103", name="Room C-103", type="classroom", capacity=60, department_id="CSE"),
            Room(id="E-201", name="Room E-201", type="classroom", capacity=65, department_id="ECE"),
            Room(id="E-202", name="Room E-202", type="classroom", capacity=50, department_id="ECE"),
            Room(id="LT-1", name="Lecture Theatre 1", type="classroom", capacity=120),
            Room(id="CL-1", name="Computer Lab 1", type="computer_lab", capacity=60),
            Room(id="CL-2", name="Computer Lab 2", type="computer_lab", capacity=60),
            Room(id="EL-1", name="Electronics Lab", type="electronics_lab", capacity=60, department_id="ECE"),
            Room(id="SH-1", name="Seminar Hall", type="seminar_hall", capacity=150),
            Room(id="AUD", name="Main Auditorium", type="auditorium", capacity=600),
        ],
    )
