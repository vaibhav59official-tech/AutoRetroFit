package pages;

public class CoursePage {
  private boolean courseOpen;
  private String batch;
  public void openCourse() { courseOpen = true; }
  public void selectMasterBatch() { if (!courseOpen) throw new IllegalStateException("Course must be open"); batch = "Master"; }
  public String selectedBatch() { return batch; }
}
