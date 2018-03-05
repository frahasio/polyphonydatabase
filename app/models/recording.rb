class Recording < ActiveRecord::Base
  belongs_to :unique_piece, inverse_of: :recordings
  belongs_to :group

  def performer_name
    performer.blank? ? "<unknown performer>" : performer
  end
end
