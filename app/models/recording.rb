class Recording < ActiveRecord::Base
  belongs_to :piece

  def performer_name
    performer.blank? ? "<unknown performer>" : performer
  end
end
