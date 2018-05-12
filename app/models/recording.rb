class Recording < ActiveRecord::Base
  belongs_to :group
  belongs_to :performer, optional: true

  def performer_name
    performer&.name || "<unknown performer>"
  end
end
