class Recording < ActiveRecord::Base
  belongs_to :unique_piece, inverse_of: :recordings, optional: true
  belongs_to :group
  belongs_to :performer, optional: true

  def performer_name
    performer&.name || "<unknown performer>"
  end
end
